import { randomUUID } from 'node:crypto';

import type { Agent } from '../domain/agent';
import type { AgentRun, AgentRunDraft, AgentRunFailureCategory } from '../domain/agentRun';
import {
  AGENT_RUN_RESULT_SCHEMA_VERSION,
  createAgentRunFailure,
  createAgentRunSuccess,
} from '../domain/agentRun';
import type { ModelRequest, ModelResponse } from '../domain/model';
import type { ModelProvider } from '../domain/modelConfig';
import type { Project } from '../domain/project';
import type { Task } from '../domain/task';
import {
  AgentNotFoundError,
  AgentRunNotFoundError,
  AgentRunSchemaError,
  LabForbiddenError,
  ModelConfigNotFoundError,
  ModelGatewayError,
  ProjectNotFoundError,
  TaskForbiddenError,
  TaskNotFoundError,
  TaskValidationError,
} from '../domain/errors';
import type { ModelConfigRef } from './modelGateway';
import type { ModelGateway } from './modelGateway';
import type { ModelConfigService } from './modelConfigService';
import type { AgentRunRepository } from './agentRunRepository';
import type { AgentMemorySource, RetrievedMemory } from './agentMemorySource';
import type { AgentRepository } from './agentRepository';
import type { LabRepository } from './labRepository';
import type { ProjectRepository } from './projectRepository';
import type { TaskRepository } from './taskRepository';
import type { TaskService } from './taskService';
import type { ArtifactService } from './artifactService';
import { assertLabOwnedBy } from './labAccess';
import { parseAgentRunResult } from './agentRunResultSchema';

export interface RunAgentParams {
  requesterUserId: string;
  agentId: string;
  taskId: string;
  instruction?: string;
  maxTokens?: number;
}

const DEFAULT_INSTRUCTION = 'Complete the assigned task and return the structured result.';

/**
 * The Agent Runtime (SPEC-006): executes one bounded Agent task against a model
 * provider and translates validated output back into domain state.
 *
 * The lifecycle is deterministic and testable (AGENT_RUNTIME.md "Determinism
 * boundary"): only the model call is nondeterministic. Steps:
 *   1. Load the Agent identity.
 *   2. Load the Task and Project; authorize that the Task is assigned to the Agent.
 *   3. Resolve the model configuration (must exist, be enabled, and live in the Agent's Lab).
 *   4. Retrieve authorized memory.
 *   5. Build context and call the ModelGateway.
 *   6. Validate the structured result against the typed schema.
 *   7. Apply only the validated task status through the TaskService state machine.
 *   8. Persist run metadata.
 *
 * Raw, unvalidated model text can never mutate persistent state (SPEC-006
 * acceptance #1): the Task is touched only after the result passes the schema,
 * and only through `TaskService.agentProposeOutcome`. Suggested tasks and memory
 * candidates stay proposals inside the run's result; artifact proposals are
 * materialized into durable Artifacts on a `succeeded` run, and the persisted
 * result carries the created artifact ids (SPEC-008 / ADR-0004).
 */
export class AgentRuntimeService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly labs: LabRepository,
    private readonly projects: ProjectRepository,
    private readonly tasks: TaskRepository,
    private readonly taskService: TaskService,
    private readonly modelConfigs: ModelConfigService,
    private readonly gateway: ModelGateway,
    private readonly runs: AgentRunRepository,
    private readonly memory: AgentMemorySource,
    private readonly artifacts: ArtifactService,
  ) {}

  async runOnce(params: RunAgentParams): Promise<AgentRun> {
    const startedAt = new Date().toISOString();

    // 1. Load the Agent identity (SPEC-006 #1) and authorize the PI against its Lab.
    const agent = this.requireAgent(params.agentId);
    this.assertLabOwnedBy(params.requesterUserId, agent.labId);

    // 2. Load the Task + Project (SPEC-006 #2). The Runtime may only run a Task
    //    assigned to this Agent — anything else is a trigger error, not a run.
    const task = this.requireTask(params.taskId);
    if (task.assigneeAgentId !== agent.id) {
      throw new TaskForbiddenError('the task is not assigned to this agent');
    }
    const project = this.requireProject(task.projectId);

    // 3. Resolve the model configuration. A missing/disabled/cross-Lab config is
    //    a classified `config` failure (traceable), not a crash.
    const resolved = this.resolveConfig(params.requesterUserId, agent);
    const draft: AgentRunDraft = {
      labId: agent.labId,
      agentId: agent.id,
      projectId: project.id,
      taskId: task.id,
      modelConfigId: resolved.modelConfigId,
      provider: resolved.provider,
      model: resolved.model,
      startedAt,
    };
    if (!resolved.ok) {
      return this.recordFailure(draft, 'config', new Date().toISOString());
    }
    const ref = resolved.ref as ModelConfigRef;

    // 4. Retrieve authorized memory (SPEC-006 #3). v0.1 ships an empty source;
    //    tests inject a fake to prove the retrieval + provenance flow.
    const memoryItems = this.memory.retrieveAuthorizedMemory({
      labId: agent.labId,
      agentId: agent.id,
      projectId: project.id,
    });

    // 5. Build context and call the ModelGateway (SPEC-006 #5).
    const request: ModelRequest = {
      messages: [
        { role: 'system', content: buildAgentSystemPrompt({ agent, project, task, memory: memoryItems }) },
        { role: 'user', content: params.instruction?.trim() || DEFAULT_INSTRUCTION },
      ],
      model: ref.config.model,
      temperature: 0,
      maxTokens: params.maxTokens,
      responseSchema: { name: 'agent_task_completion', version: AGENT_RUN_RESULT_SCHEMA_VERSION },
    };

    let response: ModelResponse;
    try {
      response = await this.gateway.generate(request, ref);
    } catch (err) {
      if (err instanceof ModelGatewayError) {
        return this.recordFailure(draft, 'provider', new Date().toISOString());
      }
      throw err;
    }

    // 6. Validate the structured result (SPEC-006 #6). Schema failure is a
    //    retryable run — nothing was applied, the Task is untouched.
    let result;
    try {
      result = parseAgentRunResult(response.content);
    } catch (err) {
      if (err instanceof AgentRunSchemaError) {
        return this.recordFailure(draft, 'schema', new Date().toISOString());
      }
      throw err;
    }

    // 7. Apply ONLY the validated task status through the TaskService state
    //    machine. An illegal transition is a classified `transition` failure and
    //    leaves the Task unchanged (SPEC-006 acceptance #3).
    try {
      this.taskService.agentProposeOutcome(agent.id, task.id, result.task_status);
    } catch (err) {
      if (err instanceof TaskValidationError) {
        return this.recordFailure(draft, 'transition', new Date().toISOString());
      }
      if (err instanceof TaskForbiddenError) {
        // Unreachable: the assignee check already ran in step 2. Defensive only.
        throw err;
      }
      throw err;
    }

    // 7.5 Materialize the validated artifact proposals into durable Artifacts
    //     (SPEC-008 acceptance #1). The run id is pre-generated so each Artifact
    //     records its source run in provenance. The persisted result then carries
    //     each proposal's created artifact id (ARCHITECTURE observability) —
    //     research output now lives in the `artifacts` table, not just the run
    //     transcript (acceptance #5). Only this `succeeded` path reaches here.
    const runId = randomUUID();
    const createdArtifacts = this.artifacts.materializeRunArtifacts({
      runId,
      projectId: project.id,
      taskId: task.id,
      agentId: agent.id,
      summary: result.summary,
      proposals: result.artifact_proposals,
    });
    const enrichedResult: typeof result = {
      ...result,
      artifact_proposals: result.artifact_proposals.map((proposal, i) => ({
        ...proposal,
        id: createdArtifacts[i]?.id,
      })),
    };

    // 8. Persist the run (SPEC-006 #7, acceptance #4).
    const run = createAgentRunSuccess(draft, enrichedResult, new Date().toISOString(), runId);
    this.runs.insert(run);
    return run;
  }

  /** All runs for an Agent (newest first), PI-owned Lab only. */
  listRuns(requesterUserId: string, agentId: string): AgentRun[] {
    const agent = this.requireAgent(agentId);
    this.assertLabOwnedBy(requesterUserId, agent.labId);
    return this.runs.findByAgent(agentId);
  }

  getRun(requesterUserId: string, runId: string): AgentRun {
    const run = this.runs.findById(runId);
    if (!run) {
      throw new AgentRunNotFoundError(runId);
    }
    this.assertLabOwnedBy(requesterUserId, run.labId);
    return run;
  }

  private recordFailure(
    draft: AgentRunDraft,
    category: AgentRunFailureCategory,
    now: string,
  ): AgentRun {
    const run = createAgentRunFailure(draft, category, now);
    this.runs.insert(run);
    return run;
  }

  /**
   * Resolves the Agent's model config. Returns `ok:false` (never throws) for
   * the config problems that classify as run failures: no config reference,
   * unknown/deleted config, config outside the Agent's Lab, or disabled config.
   * `modelConfigId`/`provider`/`model` are filled when the config row is known
   * so the failure run still links the attempted provider reference.
   */
  private resolveConfig(
    requesterUserId: string,
    agent: Agent,
  ): { ok: boolean; ref: ModelConfigRef | null; modelConfigId: string | null; provider: ModelProvider | null; model: string | null } {
    if (agent.modelConfigId == null) {
      return { ok: false, ref: null, modelConfigId: null, provider: null, model: null };
    }
    let ref: ModelConfigRef;
    try {
      ref = this.modelConfigs.resolveForGateway(requesterUserId, agent.modelConfigId);
    } catch (err) {
      if (err instanceof ModelConfigNotFoundError || err instanceof LabForbiddenError) {
        return { ok: false, ref: null, modelConfigId: null, provider: null, model: null };
      }
      throw err;
    }
    if (ref.config.labId !== agent.labId) {
      return {
        ok: false,
        ref: null,
        modelConfigId: ref.config.id,
        provider: ref.config.provider,
        model: ref.config.model,
      };
    }
    if (!ref.config.isEnabled) {
      return {
        ok: false,
        ref,
        modelConfigId: ref.config.id,
        provider: ref.config.provider,
        model: ref.config.model,
      };
    }
    return {
      ok: true,
      ref,
      modelConfigId: ref.config.id,
      provider: ref.config.provider,
      model: ref.config.model,
    };
  }

  private requireAgent(agentId: string): Agent {
    const agent = this.agents.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }
    return agent;
  }

  private requireTask(taskId: string): Task {
    const task = this.tasks.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return task;
  }

  private requireProject(projectId: string): Project {
    const project = this.projects.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }

  private assertLabOwnedBy(userId: string, labId: string): void {
    assertLabOwnedBy(this.labs, userId, labId);
  }
}

/**
 * Builds the system prompt from only the relevant state (AGENT_RUNTIME.md
 * step 3: "Avoid dumping all Lab history into the prompt"). Pure and
 * deterministic so the runtime can be tested without a model.
 */
export function buildAgentSystemPrompt(input: {
  agent: Agent;
  project: Project;
  task: Task;
  memory: RetrievedMemory[];
}): string {
  const { agent, project, task, memory } = input;
  const memoryLines =
    memory.length === 0
      ? ['(none retrieved)']
      : memory.map((m) => `- [${m.scope}] ${m.id} (by ${m.authorType}:${m.authorId}, ${m.createdAt}) ${m.content}`);

  return [
    `You are ${agent.name}, a ${agent.role} in the research lab.`,
    ...(agent.specialization ? [`Specialization: ${agent.specialization}.`] : []),
    ...(agent.profile ? [`Profile: ${agent.profile}.`] : []),
    '',
    `Project: ${project.title}`,
    ...(project.objective ? [`Project objective: ${project.objective}`] : []),
    `Project stage: ${project.stage}`,
    '',
    `Assigned task: ${task.title}`,
    ...(task.description ? [`Task description: ${task.description}`] : []),
    `Task status: ${task.status} (priority ${task.priority})`,
    '',
    'Authorized memory:',
    ...memoryLines,
    '',
    'Respond with STRICT JSON only, matching exactly:',
    '{ "summary": string, "task_status": "completed"|"blocked"|"review", "artifact_proposals": [{"title": string, "content": string, "type": string}], "findings": [{"claim": string}], "questions_for_pi": [{"question": string}], "suggested_tasks": [{"title": string, "rationale": string}], "memory_candidates": [{"content": string, "scope": "agent"|"project"|"lab"}] }',
  ].join('\n');
}
