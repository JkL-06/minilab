import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgent } from '../../src/domain/agent';
import {
  AGENT_RUN_RESULT_SCHEMA_VERSION,
  createAgentRunFailure,
  createAgentRunSuccess,
  type AgentRunDraft,
  type AgentRunResult,
} from '../../src/domain/agentRun';
import { createLab } from '../../src/domain/lab';
import { createModelConfig } from '../../src/domain/modelConfig';
import { createProject } from '../../src/domain/project';
import { createTask } from '../../src/domain/task';
import { openDatabase, type MiniLabDb } from '../../src/infrastructure/db/database';
import { SqliteAgentRepository } from '../../src/infrastructure/db/sqliteAgentRepository';
import { SqliteAgentRunRepository } from '../../src/infrastructure/db/sqliteAgentRunRepository';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteModelConfigRepository } from '../../src/infrastructure/db/sqliteModelConfigRepository';
import { SqliteProjectRepository } from '../../src/infrastructure/db/sqliteProjectRepository';
import { SqliteTaskRepository } from '../../src/infrastructure/db/sqliteTaskRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

/**
 * agent_runs has FK columns into labs/agents/projects/tasks/model_configs — an
 * orphan insert fails with a FOREIGN KEY constraint (and the `finally` cleanup
 * masks it as EBUSY), so persistence tests must seed the whole parent chain.
 */
function seedChain(db: MiniLabDb) {
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  new SqliteLabRepository(db).insert(lab);
  const agent = createAgent({ labId: lab.id, name: 'Alice' });
  new SqliteAgentRepository(db).insert(agent);
  const project = createProject({ labId: lab.id, title: 'Survey' });
  new SqliteProjectRepository(db).insert(project);
  const config = createModelConfig({ labId: lab.id, name: 'Mock', provider: 'mock', model: 'mock-a' });
  new SqliteModelConfigRepository(db).insert(config);
  const task = createTask({
    projectId: project.id,
    creatorType: 'pi',
    creatorId: 'user-1',
    assigneeAgentId: agent.id,
    title: 'Map evidence',
  });
  new SqliteTaskRepository(db).insert(task);
  return { lab, agent, project, config, task };
}

const RESULT: AgentRunResult = {
  summary: 'Completed.',
  task_status: 'completed',
  artifact_proposals: [{ title: 'Evidence map' }],
  findings: [],
  questions_for_pi: [],
  suggested_tasks: [{ title: 'Follow-up', rationale: 'next' }],
  memory_candidates: [{ content: 'candidate', scope: 'project' }],
};

const NOW = '2026-08-15T00:00:00.000Z';

test('a successful agent run persists across restart with full metadata and the validated result', () => {
  const path = tempDbPath();
  try {
    const db1 = openDatabase(path);
    const { lab, agent, project, config, task } = seedChain(db1);
    const run = createAgentRunSuccess(
      {
        labId: lab.id,
        agentId: agent.id,
        projectId: project.id,
        taskId: task.id,
        modelConfigId: config.id,
        provider: 'mock',
        model: 'mock-a',
        startedAt: NOW,
      },
      RESULT,
      NOW,
    );
    new SqliteAgentRunRepository(db1).insert(run);
    db1.close();

    // Restart: fresh connection to the same file.
    const db2 = openDatabase(path);
    const loaded = new SqliteAgentRunRepository(db2).findById(run.id);
    db2.close();

    assert.ok(loaded, 'run survives restart');
    assert.equal(loaded!.labId, lab.id);
    assert.equal(loaded!.agentId, agent.id);
    assert.equal(loaded!.projectId, project.id);
    assert.equal(loaded!.taskId, task.id);
    assert.equal(loaded!.modelConfigId, config.id);
    assert.equal(loaded!.provider, 'mock');
    assert.equal(loaded!.model, 'mock-a');
    assert.equal(loaded!.status, 'succeeded');
    assert.equal(loaded!.errorCategory, null);
    assert.equal(loaded!.resultSchemaVersion, AGENT_RUN_RESULT_SCHEMA_VERSION);
    assert.deepEqual(loaded!.result, RESULT, 'the validated result JSON round-trips');
    assert.equal(loaded!.startedAt, NOW);
    assert.equal(loaded!.endedAt, NOW);
  } finally {
    cleanupTempDb(path);
  }
});

test('a failed run persists with its error category and no result', () => {
  const path = tempDbPath();
  try {
    const db = openDatabase(path);
    const { lab, agent, project, config, task } = seedChain(db);
    const run = createAgentRunFailure(
      {
        labId: lab.id,
        agentId: agent.id,
        projectId: project.id,
        taskId: task.id,
        modelConfigId: config.id,
        provider: 'mock',
        model: 'mock-a',
        startedAt: NOW,
      },
      'schema',
      NOW,
    );
    const repo = new SqliteAgentRunRepository(db);
    repo.insert(run);

    const loaded = repo.findById(run.id)!;
    assert.equal(loaded.status, 'retryable');
    assert.equal(loaded.errorCategory, 'schema');
    assert.equal(loaded.result, null);
    assert.equal(loaded.resultSchemaVersion, null);
    db.close();
  } finally {
    cleanupTempDb(path);
  }
});

test('a config-missing failure run persists with nullable provider references', () => {
  const path = tempDbPath();
  try {
    const db = openDatabase(path);
    const { lab, agent, project, task } = seedChain(db);
    const run = createAgentRunFailure(
      {
        labId: lab.id,
        agentId: agent.id,
        projectId: project.id,
        taskId: task.id,
        modelConfigId: null,
        provider: null,
        model: null,
        startedAt: NOW,
      },
      'config',
      NOW,
    );
    const repo = new SqliteAgentRunRepository(db);
    repo.insert(run);

    const loaded = repo.findById(run.id)!;
    assert.equal(loaded.status, 'failed');
    assert.equal(loaded.errorCategory, 'config');
    assert.equal(loaded.modelConfigId, null);
    assert.equal(loaded.provider, null);
    assert.equal(loaded.model, null);
    db.close();
  } finally {
    cleanupTempDb(path);
  }
});

test('findByAgent lists an agent’s runs newest first', () => {
  const path = tempDbPath();
  try {
    const db = openDatabase(path);
    const { lab, agent, project, config, task } = seedChain(db);
    const repo = new SqliteAgentRunRepository(db);
    const draft: AgentRunDraft = {
      labId: lab.id,
      agentId: agent.id,
      projectId: project.id,
      taskId: task.id,
      modelConfigId: config.id,
      provider: 'mock',
      model: 'mock-a',
      startedAt: '2026-08-15T00:00:00.000Z',
    };
    repo.insert(createAgentRunFailure({ ...draft, startedAt: '2026-08-15T00:00:00.000Z' }, 'schema', '2026-08-15T00:00:01.000Z'));
    repo.insert(createAgentRunSuccess({ ...draft, startedAt: '2026-08-15T00:00:02.000Z' }, RESULT, '2026-08-15T00:00:03.000Z'));

    const runs = repo.findByAgent(agent.id);
    assert.deepEqual(runs.map((r) => r.status), ['succeeded', 'retryable'], 'newest first');
    assert.equal(repo.findByAgent('no-such-agent').length, 0);
    db.close();
  } finally {
    cleanupTempDb(path);
  }
});
