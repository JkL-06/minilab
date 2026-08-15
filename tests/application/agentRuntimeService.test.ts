import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelRequest, ModelResponse } from '../../src/domain/model';
import { LabForbiddenError, ModelGatewayError, TaskForbiddenError } from '../../src/domain/errors';
import { AgentService } from '../../src/application/agentService';
import { LabService } from '../../src/application/labService';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';
import { testAgentRuntime } from '../support/testAgentRuntime';
import { testModelInfra } from '../support/testModelGateway';
import { inMemoryAgentRunRepository } from '../support/inMemoryAgentRunRepository';
import type { AgentMemorySource, RetrievedMemory } from '../../src/application/agentMemorySource';

const USER = 'user-1';
const OTHER = 'user-2';

/** A scriptable memory source so tests can prove retrieval reaches the prompt. */
class ScriptedMemorySource implements AgentMemorySource {
  items: RetrievedMemory[] = [];
  retrieveAuthorizedMemory() {
    return this.items;
  }
}

function successResponse(content?: unknown): ModelResponse {
  return {
    content: JSON.stringify(
      content ??
        ({
          summary: 'Completed.',
          task_status: 'completed',
          artifact_proposals: [],
          findings: [],
          questions_for_pi: [],
          suggested_tasks: [],
          memory_candidates: [],
        } as const),
    ),
    provider: 'mock',
    model: 'mock-a',
    finishReason: 'stop',
    usage: null,
  };
}

interface World {
  lab: { id: string };
  alice: { id: string };
  bob: { id: string };
  project: { id: string };
  config: { id: string };
  task: { id: string; projectId: string };
  tasks: TaskService;
  agentService: AgentService;
  taskRepo: { tasks: unknown[] };
  runtime: ReturnType<typeof testAgentRuntime>['runtime'];
  runs: ReturnType<typeof inMemoryAgentRunRepository>;
  artifacts: ReturnType<typeof testAgentRuntime>['artifacts'];
  mock: ReturnType<typeof testModelInfra>['mock'];
  memorySource: ScriptedMemorySource;
  modelConfigService: ReturnType<typeof testModelInfra>['modelConfigService'];
}

function createWorld(memorySource = new ScriptedMemorySource()): World {
  const labRepo = inMemoryLabRepository();
  const agentRepo = inMemoryAgentRepository();
  const projectRepo = inMemoryProjectRepository();
  const taskRepo = inMemoryTaskRepository();
  const labs = new LabService(labRepo);
  const agents = new AgentService(agentRepo, labRepo);
  const projects = new ProjectService(projectRepo, labRepo);
  const tasks = new TaskService(taskRepo, projectRepo, agentRepo, labRepo);
  const infra = testModelInfra(labRepo);

  const lab = labs.createLab(USER, 'Lab');
  const alice = agents.createAgent(USER, lab.id, { name: 'Alice' });
  const bob = agents.createAgent(USER, lab.id, { name: 'Bob' });
  const project = projects.createProject(USER, lab.id, { title: 'Survey' });
  const config = infra.modelConfigService.createModelConfig(USER, lab.id, {
    name: 'Mock',
    provider: 'mock',
    model: 'mock-a',
  });
  // Bind Alice to the model config so she can execute runs (Bob stays unbound).
  agents.updateAgent(USER, alice.id, { modelConfigId: config.id });
  const task = tasks.createTask(USER, project.id, { title: 'Map evidence', assigneeAgentId: alice.id });

  const { runtime, runs, artifacts } = testAgentRuntime({
    agentRepo,
    labRepo,
    projectRepo,
    taskRepo,
    modelConfigService: infra.modelConfigService,
    gateway: infra.gateway,
    memorySource,
  });

  return {
    lab,
    alice,
    bob,
    project,
    config,
    task,
    tasks,
    agentService: agents,
    taskRepo,
    runtime,
    runs,
    artifacts,
    mock: infra.mock,
    memorySource,
    modelConfigService: infra.modelConfigService,
  };
}

/** Moves a task into `running` so a `completed` proposal is legal. */
function advanceToRunning(tasks: TaskService, taskId: string) {
  tasks.updateTask(USER, taskId, { status: 'ready' });
  tasks.updateTask(USER, taskId, { status: 'running' });
}

test('a successful run completes the task and links full metadata (SPEC-006 acceptance #4)', async () => {
  const { alice, task, tasks, runtime, runs } = createWorld();
  advanceToRunning(tasks, task.id);

  const run = await runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id });

  assert.equal(run.status, 'succeeded');
  assert.equal(run.errorCategory, null);
  assert.ok(run.id, 'traceable by ID');
  // Run metadata links Agent, Project, Task, and the provider/model reference.
  assert.equal(run.agentId, alice.id);
  assert.equal(run.projectId, task.projectId);
  assert.equal(run.taskId, task.id);
  assert.equal(run.modelConfigId, run.modelConfigId);
  assert.equal(run.provider, 'mock');
  assert.equal(run.model, 'mock-a');

  // The validated result is applied through the state machine.
  assert.equal(tasks.getTask(USER, task.id).status, 'completed');

  // The structured result is persisted with the full AGENT_RUNTIME schema.
  assert.equal(
    run.result!.summary,
    'Mock completion for: Complete the assigned task and return the structured result.',
    'the schema-aware mock reply is applied',
  );
  assert.equal(run.result!.task_status, 'completed');
  assert.deepEqual(Object.keys(run.result!).sort(), [
    'artifact_proposals',
    'findings',
    'memory_candidates',
    'questions_for_pi',
    'suggested_tasks',
    'summary',
    'task_status',
  ]);

  assert.equal(runs.findById(run.id)?.id, run.id, 'run is persisted');
});

test('unvalidated raw text cannot mutate persistent state (acceptance #1, #2): schema failure is a retryable run and the task is untouched', async () => {
  const { alice, task, tasks, runtime, runs, mock } = createWorld();
  advanceToRunning(tasks, task.id);

  // The model returns raw text, not JSON. This must not touch the Task.
  mock.onCall(() => ({ ...successResponse(), content: 'Sure, I will do it. Task completed.' }));

  const run = await runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id });

  assert.equal(run.status, 'retryable', 'schema failure is retryable');
  assert.equal(run.errorCategory, 'schema');
  assert.equal(run.result, null);
  assert.equal(tasks.getTask(USER, task.id).status, 'running', 'task state is unchanged');
  assert.equal(runs.findById(run.id)?.status, 'retryable', 'failure is persisted');
});

test('provider failure does not corrupt task state (acceptance #3): retryable run, task unchanged', async () => {
  const { alice, task, tasks, runtime, runs, mock } = createWorld();
  advanceToRunning(tasks, task.id);

  mock.onCall(() => {
    throw new ModelGatewayError('provider_unavailable', 'provider is down');
  });

  const run = await runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id });

  assert.equal(run.status, 'retryable');
  assert.equal(run.errorCategory, 'provider');
  assert.equal(run.result, null);
  assert.equal(tasks.getTask(USER, task.id).status, 'running', 'task is not corrupted');
  assert.equal(runs.findById(run.id)?.status, 'retryable');
});

test('an illegal proposed transition is a failed run and the task stays put', async () => {
  const { alice, task, tasks, runtime } = createWorld();
  // The task is still in `backlog`; the mock proposes `completed`. The state
  // machine rejects backlog → completed, so the run fails as a transition
  // problem and the Task is unchanged.

  const run = await runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id });

  assert.equal(run.status, 'failed');
  assert.equal(run.errorCategory, 'transition');
  assert.equal(tasks.getTask(USER, task.id).status, 'backlog', 'task unchanged');
});

test('an agent with no model config produces a config failure run (traceable), not a crash', async () => {
  const { bob, task, tasks, runtime, runs } = createWorld();
  const unconfigured = tasks.updateTask(USER, task.id, { assigneeAgentId: bob.id });

  const run = await runtime.runOnce({ requesterUserId: USER, agentId: bob.id, taskId: unconfigured.id });

  assert.equal(run.status, 'failed');
  assert.equal(run.errorCategory, 'config');
  assert.equal(run.provider, null, 'no provider reference for a missing config');
  assert.equal(runs.findById(run.id)?.errorCategory, 'config');
});

test('a disabled model config produces a config failure run', async () => {
  const { alice, task, tasks, runtime, modelConfigService, config } = createWorld();
  modelConfigService.updateModelConfig(USER, config.id, { isEnabled: false });
  advanceToRunning(tasks, task.id);

  const run = await runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id });

  assert.equal(run.status, 'failed');
  assert.equal(run.errorCategory, 'config');
});

test('a model config from another lab is rejected as a config failure (no cross-lab reuse)', async () => {
  // Two Labs owned by the SAME user; Alice lives in Lab A but is pointed at a
  // config in Lab B. resolveForGateway passes on ownership, so the Runtime's own
  // same-Lab check must reject the run as a `config` failure.
  const labRepo = inMemoryLabRepository();
  const agentRepo = inMemoryAgentRepository();
  const projectRepo = inMemoryProjectRepository();
  const taskRepo = inMemoryTaskRepository();
  const labs = new LabService(labRepo);
  const agents = new AgentService(agentRepo, labRepo);
  const projects = new ProjectService(projectRepo, labRepo);
  const tasks = new TaskService(taskRepo, projectRepo, agentRepo, labRepo);
  const infra = testModelInfra(labRepo);

  const labA = labs.createLab(USER, 'Lab A');
  const labB = labs.createLab(USER, 'Lab B');
  const alice = agents.createAgent(USER, labA.id, { name: 'Alice' });
  const configB = infra.modelConfigService.createModelConfig(USER, labB.id, {
    name: 'B',
    provider: 'mock',
    model: 'mock-b',
  });
  const project = projects.createProject(USER, labA.id, { title: 'Survey' });
  const task = tasks.createTask(USER, project.id, { title: 'T', assigneeAgentId: alice.id });
  agents.updateAgent(USER, alice.id, { modelConfigId: configB.id });
  const { runtime } = testAgentRuntime({
    agentRepo,
    labRepo,
    projectRepo,
    taskRepo,
    modelConfigService: infra.modelConfigService,
    gateway: infra.gateway,
  });

  const run = await runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id });

  assert.equal(run.status, 'failed');
  assert.equal(run.errorCategory, 'config');
  assert.equal(run.provider, 'mock', 'run still links the attempted provider reference');
  assert.equal(tasks.getTask(USER, task.id).status, 'backlog', 'task untouched');
});

test('the runtime refuses a task not assigned to the agent (trigger error, no run record)', async () => {
  const { alice, bob, task, tasks, runtime, runs } = createWorld();
  tasks.updateTask(USER, task.id, { assigneeAgentId: bob.id });

  await assert.rejects(
    runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id }),
    TaskForbiddenError,
  );
  assert.equal(runs['runs'].length, 0, 'no run record for a rejected trigger');
});

test('a non-owner cannot run an agent in someone else’s lab', async () => {
  const { alice, task, runtime, runs } = createWorld();
  await assert.rejects(
    runtime.runOnce({ requesterUserId: OTHER, agentId: alice.id, taskId: task.id }),
    LabForbiddenError,
  );
  assert.equal(runs['runs'].length, 0);
});

test('authorized memory is retrieved and flows into the system prompt with provenance (SPEC-006 #3)', async () => {
  const { alice, task, tasks, runtime, mock, memorySource } = createWorld();
  advanceToRunning(tasks, task.id);

  memorySource.items = [
    {
      id: 'mem-1',
      scope: 'project',
      sourceType: 'decision',
      sourceId: 'dec-1',
      authorType: 'pi',
      authorId: USER,
      content: 'The evidence base must cover 2020–2026.',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];

  const captured: { request: ModelRequest | null } = { request: null };
  mock.onCall((request) => {
    captured.request = request;
    return successResponse();
  });

  await runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id });

  assert.ok(captured.request, 'the gateway was called');
  assert.ok(captured.request!.responseSchema, 'the typed schema is declared on the request');
  const system = captured.request!.messages.find((m) => m.role === 'system')!.content;
  assert.match(system, /The evidence base must cover 2020–2026\./, 'memory content reaches the prompt');
  assert.match(system, /\[project\] mem-1/, 'scope + memory ID provenance is present');
  assert.match(system, /by pi:user-1/, 'author provenance is present');
});

test('suggested tasks / memory candidates stay proposals, artifact proposals materialize (acceptance #5)', async () => {
  const { alice, project, task, tasks, taskRepo, runtime, artifacts } = createWorld();
  advanceToRunning(tasks, task.id);

  const run = await runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id });

  assert.equal(run.status, 'succeeded');
  assert.equal(taskRepo['tasks'].length, 1, 'no follow-up Task entity was created');
  assert.equal(run.result!.suggested_tasks.length, 1, 'proposals are recorded in the run result');
  assert.equal(run.result!.memory_candidates.length, 1);
  assert.equal(tasks.getTask(USER, task.id).status, 'completed');

  // SPEC-008 supersedes SPEC-006 for artifacts only: a succeeded run materializes
  // its artifact proposals into durable rows (acceptance #1, #5), and the persisted
  // run result carries each created artifact id (observability).
  const materialized = artifacts.artifacts;
  assert.equal(materialized.length, 1, 'one Artifact row was created by the run');
  const [artifact] = materialized;
  assert.equal(artifact.projectId, project.id, 'artifact is linked to its Project (acceptance #3)');
  assert.equal(artifact.taskId, task.id, 'artifact links the producing Task');
  assert.equal(artifact.creatorAgentId, alice.id, 'artifact links the producing Agent');
  assert.equal(artifact.type, 'note');
  assert.equal(artifact.version, 1, 'version metadata is preserved (acceptance #4)');
  assert.equal(artifact.content, 'A durable note produced by the mock provider.', 'proposal content is stored');
  assert.equal((artifact.metadata as { sourceRunId?: string }).sourceRunId, run.id, 'provenance records the source run');
  assert.equal(run.result!.artifact_proposals[0].id, artifact.id, 'run result carries the created artifact id');
});

test('listRuns and getRun authorize by lab ownership and return persisted runs', async () => {
  const { alice, task, tasks, runtime } = createWorld();
  advanceToRunning(tasks, task.id);
  await runtime.runOnce({ requesterUserId: USER, agentId: alice.id, taskId: task.id });

  const listed = runtime.listRuns(USER, alice.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, 'succeeded');

  const fetched = runtime.getRun(USER, listed[0].id);
  assert.equal(fetched.id, listed[0].id);

  // Cross-lab reads are rejected.
  assert.throws(() => runtime.listRuns(OTHER, alice.id), LabForbiddenError);
  assert.throws(() => runtime.getRun(OTHER, listed[0].id), LabForbiddenError);
});
