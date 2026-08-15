import { randomUUID } from 'node:crypto';

import { AgentRunValidationError } from './errors';
import type { ModelProvider } from './modelConfig';

/**
 * Agent Run is the record of one bounded Agent execution attempt (SPEC-006).
 *
 * An AgentRun is not a Task and not an Agent: it is durable observability for a
 * single `Agent → model → Task` interaction. It links an Agent, its Lab,
 * Project, Task, and the exact provider/model used, and records the classified
 * outcome (success, retryable failure, hard failure) plus the *validated*
 * structured result. Suggested tasks and memory candidates are recorded as data
 * and never materialized as entities here; artifact proposals are materialized
 * into Artifacts on a `succeeded` run by the ArtifactService, and the persisted
 * result carries the created artifact ids (SPEC-008 / ADR-0004, superseding the
 * SPEC-006 "proposals stay proposals" rule for artifacts only).
 *
 * A run is written exactly once, when the attempt terminates. Precondition
 * violations (not a Lab owner, task not assigned to the Agent) are trigger
 * errors and never produce a run.
 */

export const RUN_OUTCOME_STATUSES: ['succeeded', 'retryable', 'failed'] = [
  'succeeded',
  'retryable',
  'failed',
];

export type AgentRunOutcomeStatus = (typeof RUN_OUTCOME_STATUSES)[number];

/**
 * Why a run did not succeed. `provider`/`schema` map to `retryable`; `config`/
 * `transition` map to `failed`.
 */
export const RUN_FAILURE_CATEGORIES: [
  'provider',
  'schema',
  'config',
  'transition',
] = ['provider', 'schema', 'config', 'transition'];

export type AgentRunFailureCategory = (typeof RUN_FAILURE_CATEGORIES)[number];

/** The task status an Agent may propose in its structured result (AGENT_RUNTIME.md). */
export const AGENT_TASK_STATUS_PROPOSALS: ['completed', 'blocked', 'review'] = [
  'completed',
  'blocked',
  'review',
];

export type AgentTaskStatusProposal = (typeof AGENT_TASK_STATUS_PROPOSALS)[number];

// --- Structured result (AGENT_RUNTIME.md task-completion schema) ---

/**
 * Version of the validated task-completion result schema. The domain owns the
 * constant; the application schema validator validates against it. Bump when the
 * shape changes — old run records keep their own `result_schema_version`.
 *
 * v2 (SPEC-008): artifact proposals gain optional `content`/`type` so a completed
 * run can materialize durable Artifacts. The server additionally backfills the
 * created artifact `id` into the persisted result (observability, ARCHITECTURE.md);
 * the model can never supply it — the validator stays `.strict()` on
 * `{ title, content?, type? }` (ADR-0004).
 */
export const AGENT_RUN_RESULT_SCHEMA_VERSION = 2;

export interface AgentArtifactProposal {
  title: string;
  /** Durable content stored in the materialized Artifact (SPEC-008). */
  content?: string;
  /** Free-form artifact type (e.g. `report`, `literature-map`). */
  type?: string;
  /** Server-set after materialization: the created Artifact's id. */
  id?: string;
}

export interface AgentRunFinding {
  claim: string;
}

export interface AgentRunQuestion {
  question: string;
}

export interface AgentSuggestedTask {
  title: string;
  rationale?: string;
}

export interface AgentMemoryCandidate {
  content: string;
  scope: 'agent' | 'project' | 'lab';
}

/** Snake_case to match the AGENT_RUNTIME.md schema exactly (SPEC-006 #6). */
export interface AgentRunResult {
  summary: string;
  task_status: AgentTaskStatusProposal;
  artifact_proposals: AgentArtifactProposal[];
  findings: AgentRunFinding[];
  questions_for_pi: AgentRunQuestion[];
  suggested_tasks: AgentSuggestedTask[];
  memory_candidates: AgentMemoryCandidate[];
}

// --- Run entity ---

export interface AgentRunDraft {
  labId: string;
  agentId: string;
  projectId: string;
  taskId: string;
  /** Null when the attempt failed before a model config could be resolved. */
  modelConfigId: string | null;
  provider: ModelProvider | null;
  model: string | null;
  startedAt: string;
}

export interface AgentRun {
  id: string;
  labId: string;
  agentId: string;
  projectId: string;
  taskId: string;
  modelConfigId: string | null;
  provider: ModelProvider | null;
  model: string | null;
  status: AgentRunOutcomeStatus;
  errorCategory: AgentRunFailureCategory | null;
  resultSchemaVersion: number | null;
  result: AgentRunResult | null;
  startedAt: string;
  endedAt: string;
  createdAt: string;
}

export function validateRunOutcomeStatus(status: unknown): AgentRunOutcomeStatus {
  if (!RUN_OUTCOME_STATUSES.includes(status as AgentRunOutcomeStatus)) {
    throw new AgentRunValidationError(
      `status must be one of: ${RUN_OUTCOME_STATUSES.join(', ')}`,
    );
  }
  return status as AgentRunOutcomeStatus;
}

export function validateRunFailureCategory(category: unknown): AgentRunFailureCategory {
  if (!RUN_FAILURE_CATEGORIES.includes(category as AgentRunFailureCategory)) {
    throw new AgentRunValidationError(
      `failure category must be one of: ${RUN_FAILURE_CATEGORIES.join(', ')}`,
    );
  }
  return category as AgentRunFailureCategory;
}

/** The outcome status implied by a failure category (deterministic mapping). */
export function runStatusForFailure(category: AgentRunFailureCategory): AgentRunOutcomeStatus {
  return category === 'provider' || category === 'schema' ? 'retryable' : 'failed';
}

/**
 * Builds a `succeeded` run around a fully validated structured result. The
 * optional `id` lets the Runtime pre-generate the run id so materialized
 * artifacts can reference it in their provenance before the run is persisted.
 */
export function createAgentRunSuccess(
  draft: AgentRunDraft,
  result: AgentRunResult,
  now: string,
  id: string = randomUUID(),
): AgentRun {
  return {
    ...draft,
    id,
    status: 'succeeded',
    errorCategory: null,
    resultSchemaVersion: AGENT_RUN_RESULT_SCHEMA_VERSION,
    result,
    endedAt: now,
    createdAt: now,
  };
}

/** Builds a failed run (status derived from the category). */
export function createAgentRunFailure(
  draft: AgentRunDraft,
  category: AgentRunFailureCategory,
  now: string,
): AgentRun {
  return {
    ...draft,
    id: randomUUID(),
    status: runStatusForFailure(category),
    errorCategory: category,
    resultSchemaVersion: null,
    result: null,
    endedAt: now,
    createdAt: now,
  };
}
