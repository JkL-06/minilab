import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_RUN_RESULT_SCHEMA_VERSION,
  AGENT_TASK_STATUS_PROPOSALS,
  createAgentRunFailure,
  createAgentRunSuccess,
  RUN_FAILURE_CATEGORIES,
  runStatusForFailure,
  RUN_OUTCOME_STATUSES,
  validateRunFailureCategory,
  validateRunOutcomeStatus,
  type AgentRunDraft,
  type AgentRunResult,
} from '../../src/domain/agentRun';
import { AgentRunValidationError } from '../../src/domain/errors';

const NOW = '2026-08-15T00:00:00.000Z';

const draft: AgentRunDraft = {
  labId: 'lab-1',
  agentId: 'agent-1',
  projectId: 'project-1',
  taskId: 'task-1',
  modelConfigId: 'config-1',
  provider: 'mock',
  model: 'mock-a',
  startedAt: NOW,
};

const result: AgentRunResult = {
  summary: 'Done.',
  task_status: 'completed',
  artifact_proposals: [],
  findings: [],
  questions_for_pi: [],
  suggested_tasks: [],
  memory_candidates: [],
};

test('run outcome statuses and failure categories are the stable taxonomy (ADR-0002)', () => {
  assert.deepEqual(RUN_OUTCOME_STATUSES, ['succeeded', 'retryable', 'failed']);
  assert.deepEqual(RUN_FAILURE_CATEGORIES, ['provider', 'schema', 'config', 'transition']);
  assert.deepEqual(AGENT_TASK_STATUS_PROPOSALS, ['completed', 'blocked', 'review']);
});

test('runStatusForFailure derives the outcome status deterministically (SPEC-006 acceptance #2)', () => {
  assert.equal(runStatusForFailure('provider'), 'retryable', 'provider failure is retryable');
  assert.equal(runStatusForFailure('schema'), 'retryable', 'schema failure is retryable');
  assert.equal(runStatusForFailure('config'), 'failed', 'config failure is a hard failure');
  assert.equal(runStatusForFailure('transition'), 'failed', 'transition failure is a hard failure');
});

test('validators accept the taxonomy and reject anything else', () => {
  for (const status of RUN_OUTCOME_STATUSES) {
    assert.equal(validateRunOutcomeStatus(status), status);
  }
  for (const category of RUN_FAILURE_CATEGORIES) {
    assert.equal(validateRunFailureCategory(category), category);
  }
  assert.throws(() => validateRunOutcomeStatus('running'), AgentRunValidationError);
  assert.throws(() => validateRunFailureCategory('nope'), AgentRunValidationError);
});

test('createAgentRunSuccess builds a succeeded run that links Agent/Project/Task/provider and carries the validated result', () => {
  const run = createAgentRunSuccess(draft, result, NOW);

  assert.ok(run.id, 'traceable by ID');
  assert.equal(run.labId, 'lab-1');
  assert.equal(run.agentId, 'agent-1');
  assert.equal(run.projectId, 'project-1');
  assert.equal(run.taskId, 'task-1');
  assert.equal(run.modelConfigId, 'config-1');
  assert.equal(run.provider, 'mock');
  assert.equal(run.model, 'mock-a');
  assert.equal(run.status, 'succeeded');
  assert.equal(run.errorCategory, null);
  assert.equal(run.resultSchemaVersion, AGENT_RUN_RESULT_SCHEMA_VERSION);
  assert.deepEqual(run.result, result);
  assert.equal(run.startedAt, NOW);
  assert.equal(run.endedAt, NOW);
  assert.equal(run.createdAt, NOW);
});

test('createAgentRunFailure derives the outcome status and stores no result', () => {
  const run = createAgentRunFailure(draft, 'schema', NOW);

  assert.equal(run.status, 'retryable');
  assert.equal(run.errorCategory, 'schema');
  assert.equal(run.result, null);
  assert.equal(run.resultSchemaVersion, null);
  assert.equal(run.startedAt, NOW);
  assert.equal(run.endedAt, NOW);
});

test('a provider failure run still links the provider reference it tried to use', () => {
  const run = createAgentRunFailure(draft, 'provider', NOW);
  assert.equal(run.status, 'retryable');
  assert.equal(run.modelConfigId, 'config-1');
  assert.equal(run.provider, 'mock');
  assert.equal(run.model, 'mock-a');
});
