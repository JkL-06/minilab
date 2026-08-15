import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp } from '../../src/api/app';
import { AgentRuntimeService } from '../../src/application/agentRuntimeService';
import { AgentService } from '../../src/application/agentService';
import { ArtifactService } from '../../src/application/artifactService';
import { DashboardService } from '../../src/application/dashboardService';
import { LabService } from '../../src/application/labService';
import { ModelConfigService } from '../../src/application/modelConfigService';
import { ModelGatewayService } from '../../src/application/modelGateway';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { openDatabase, type MiniLabDb } from '../../src/infrastructure/db/database';
import { SqliteAgentRepository } from '../../src/infrastructure/db/sqliteAgentRepository';
import { SqliteAgentRunRepository } from '../../src/infrastructure/db/sqliteAgentRunRepository';
import { SqliteArtifactRepository } from '../../src/infrastructure/db/sqliteArtifactRepository';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteModelConfigRepository } from '../../src/infrastructure/db/sqliteModelConfigRepository';
import { SqliteProjectRepository } from '../../src/infrastructure/db/sqliteProjectRepository';
import { SqliteTaskRepository } from '../../src/infrastructure/db/sqliteTaskRepository';
import { MemoryService } from '../../src/application/memoryService';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { SqliteMemoryRepository } from '../../src/infrastructure/db/sqliteMemoryRepository';
import { OpenAICompatibleAdapter } from '../../src/infrastructure/models/adapters/openAiCompatibleAdapter';
import { MockProviderAdapter } from '../../src/infrastructure/models/adapters/mockProviderAdapter';
import { getOrCreateCredentialCipher } from '../../src/infrastructure/models/credentialCipher';
import { MeetingService } from '../../src/application/meetingService';
import { SqliteMeetingRepository } from '../../src/infrastructure/db/sqliteMeetingRepository';
import { SqliteDecisionRepository } from '../../src/infrastructure/db/sqliteDecisionRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

function appWith(db: MiniLabDb, dbPath: string) {
  const labRepository = new SqliteLabRepository(db);
  const agentRepository = new SqliteAgentRepository(db);
  const projectRepository = new SqliteProjectRepository(db);
  const taskRepository = new SqliteTaskRepository(db);
  const labService = new LabService(labRepository);
  const agentService = new AgentService(agentRepository, labRepository);
  const projectService = new ProjectService(projectRepository, labRepository);
  const taskService = new TaskService(taskRepository, projectRepository, agentRepository, labRepository);
  const modelConfigService = new ModelConfigService(
    new SqliteModelConfigRepository(db),
    labRepository,
    getOrCreateCredentialCipher(undefined, `${dbPath}.key`),
  );
  const modelGateway = new ModelGatewayService({
    openai_compatible: new OpenAICompatibleAdapter(),
    mock: new MockProviderAdapter(),
  });
  const memoryService = new MemoryService(
    new SqliteMemoryRepository(db),
    labRepository,
    agentRepository,
    projectRepository,
    new KeywordMemorySearch(),
  );
  const artifactService = new ArtifactService(
    new SqliteArtifactRepository(db),
    projectRepository,
    labRepository,
  );
  const agentRuntime = new AgentRuntimeService(
    agentRepository,
    labRepository,
    projectRepository,
    taskRepository,
    taskService,
    modelConfigService,
    modelGateway,
    new SqliteAgentRunRepository(db),
    memoryService,
    artifactService,
  );
  const meetingService = new MeetingService(
    new SqliteMeetingRepository(db),
    new SqliteDecisionRepository(db),
    projectRepository,
    labRepository,
    agentRepository,
    taskRepository,
    new SqliteArtifactRepository(db),
    taskService,
    memoryService,
  );
  const dashboardService = new DashboardService(
    labRepository,
    agentRepository,
    projectRepository,
    taskRepository,
    new SqliteArtifactRepository(db),
    new SqliteMeetingRepository(db),
    new SqliteDecisionRepository(db),
    new SqliteAgentRunRepository(db),
  );
  return createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway, agentRuntime, memoryService, artifactService, meetingService, dashboardService });
}

/**
 * Acceptance criteria (SPEC-006):
 *  4. Run metadata links Agent, Project, Task, and the provider/model reference.
 *  5. Suggested tasks remain proposals (never materialized as Task rows).
 * Plus the cross-cutting rule: everything survives a restart.
 */
test('acceptance: an agent run completes a task, and the run + task survive restart', async () => {
  const dbPath = tempDbPath();
  try {
    let aliceId: string;
    let taskId: string;

    // --- First application instance ---
    {
      const db1 = openDatabase(dbPath);
      const app1 = appWith(db1, dbPath);

      const labRes = await request(app1).post('/labs').set('X-User-Id', 'user-1').send({ name: 'Lab' });
      assert.equal(labRes.status, 201);
      const labId = labRes.body.lab.id as string;

      const aliceRes = await request(app1)
        .post(`/labs/${labId}/agents`)
        .set('X-User-Id', 'user-1')
        .send({ name: 'Alice' });
      assert.equal(aliceRes.status, 201);
      aliceId = aliceRes.body.agent.id as string;

      const projRes = await request(app1)
        .post(`/labs/${labId}/projects`)
        .set('X-User-Id', 'user-1')
        .send({ title: 'Evidence survey' });
      assert.equal(projRes.status, 201);
      const projectId = projRes.body.project.id as string;

      const configRes = await request(app1)
        .post(`/labs/${labId}/model-configs`)
        .set('X-User-Id', 'user-1')
        .send({ name: 'Mock', provider: 'mock', model: 'mock-a' });
      assert.equal(configRes.status, 201);
      const configId = configRes.body.modelConfig.id as string;

      const bindRes = await request(app1)
        .patch(`/agents/${aliceId}`)
        .set('X-User-Id', 'user-1')
        .send({ modelConfigId: configId });
      assert.equal(bindRes.status, 200);

      const taskRes = await request(app1)
        .post(`/projects/${projectId}/tasks`)
        .set('X-User-Id', 'user-1')
        .send({ title: 'Map the evidence base.', assigneeAgentId: aliceId });
      assert.equal(taskRes.status, 201);
      taskId = taskRes.body.task.id as string;

      // Advance the task to `running` so the schema-aware mock's `completed` is legal.
      for (const status of ['ready', 'running']) {
        const move = await request(app1)
          .patch(`/tasks/${taskId}`)
          .set('X-User-Id', 'user-1')
          .send({ status });
        assert.equal(move.status, 200);
      }

      // The Agent executes the task once.
      const runRes = await request(app1)
        .post(`/agents/${aliceId}/runs`)
        .set('X-User-Id', 'user-1')
        .send({ taskId, instruction: 'Map the evidence base.' });
      assert.equal(runRes.status, 201);
      const run = runRes.body.run;
      assert.equal(run.status, 'succeeded');
      assert.equal(run.agentId, aliceId);
      assert.equal(run.taskId, taskId);
      assert.equal(run.projectId, projectId);
      assert.equal(run.modelConfigId, configId);
      assert.equal(run.provider, 'mock');
      assert.equal(run.model, 'mock-a');
      assert.equal(run.result.task_status, 'completed');

      // The task is completed and its run carries proposals only as data.
      const afterRun = await request(app1).get(`/tasks/${taskId}`).set('X-User-Id', 'user-1');
      assert.equal(afterRun.body.task.status, 'completed');

      const projectTasks = await request(app1)
        .get(`/projects/${projectId}/tasks`)
        .set('X-User-Id', 'user-1');
      assert.equal(projectTasks.body.tasks.length, 1, 'suggested tasks stay proposals (acceptance #5)');

      db1.close();
    }

    // --- Second application instance on the same database file ("restart") ---
    {
      const db2 = openDatabase(dbPath);
      const app2 = appWith(db2, dbPath);

      // The applied task status persists.
      const taskRes = await request(app2).get(`/tasks/${taskId}`).set('X-User-Id', 'user-1');
      assert.equal(taskRes.status, 200);
      assert.equal(taskRes.body.task.status, 'completed', 'task completion survives restart');

      // The run log persists with full metadata and the validated result.
      const listRes = await request(app2)
        .get(`/agents/${aliceId}/runs`)
        .set('X-User-Id', 'user-1');
      assert.equal(listRes.status, 200);
      assert.equal(listRes.body.runs.length, 1);

      const runId = listRes.body.runs[0].id as string;
      const getRes = await request(app2).get(`/runs/${runId}`).set('X-User-Id', 'user-1');
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.run.status, 'succeeded');
      assert.equal(getRes.body.run.errorCategory, null);
      assert.equal(getRes.body.run.result.task_status, 'completed');
      assert.equal(getRes.body.run.provider, 'mock');

      db2.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});
