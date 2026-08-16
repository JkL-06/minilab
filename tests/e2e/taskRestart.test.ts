import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';
import { testAuthDeps } from '../support/testAuth';

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
  return createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway, agentRuntime, memoryService, artifactService, meetingService, dashboardService, ...testAuthDeps() });
}

/**
 * Acceptance criteria (SPEC-004):
 *  1. PI can assign a Task to Alice.
 *  2. The Task remains associated with Alice after restart.
 *  3. The assignee must belong to the same Lab as the Project.
 *  4. Invalid status transitions are rejected.
 *  5. Completing a Task does not require deleting its prior history.
 */
test('acceptance: a task stays assigned to Alice across restart, with same-lab and state-machine rules enforced', async () => {
  const dbPath = tempDbPath();
  try {
    let projectId: string;
    let taskId: string;
    let aliceId: string;

    // --- First application instance ---
    {
      const db1 = openDatabase(dbPath);
      const app1 = appWith(db1, dbPath);

      const labRes = await request(app1).post('/labs').set('X-User-Id', 'user-1').send({ name: 'Lab' });
      assert.equal(labRes.status, 201);
      const labId = labRes.body.lab.id;

      const aliceRes = await request(app1)
        .post(`/labs/${labId}/agents`)
        .set('X-User-Id', 'user-1')
        .send({ name: 'Alice' });
      assert.equal(aliceRes.status, 201);
      aliceId = aliceRes.body.agent.id;

      const projRes = await request(app1)
        .post(`/labs/${labId}/projects`)
        .set('X-User-Id', 'user-1')
        .send({ title: 'Memory & Decision' });
      assert.equal(projRes.status, 201);
      projectId = projRes.body.project.id;

      // #1: PI assigns a Task to Alice.
      const createRes = await request(app1)
        .post(`/projects/${projectId}/tasks`)
        .set('X-User-Id', 'user-1')
        .send({ title: 'Map the evidence base.', assigneeAgentId: aliceId, priority: 'high' });
      assert.equal(createRes.status, 201);
      assert.equal(createRes.body.task.assigneeAgentId, aliceId);
      taskId = createRes.body.task.id;

      // #3: an assignee from another Lab is rejected.
      const otherLab = await request(app1)
        .post('/labs')
        .set('X-User-Id', 'user-2')
        .send({ name: 'Other Lab' });
      const mallory = await request(app1)
        .post(`/labs/${otherLab.body.lab.id}/agents`)
        .set('X-User-Id', 'user-2')
        .send({ name: 'Mallory' });
      const crossLab = await request(app1)
        .post(`/projects/${projectId}/tasks`)
        .set('X-User-Id', 'user-1')
        .send({ title: 'Invalid', assigneeAgentId: mallory.body.agent.id });
      assert.equal(crossLab.status, 403);

      // #4: an invalid status transition is rejected; a valid one is applied.
      const invalid = await request(app1)
        .patch(`/tasks/${taskId}`)
        .set('X-User-Id', 'user-1')
        .send({ status: 'completed' });
      assert.equal(invalid.status, 400, 'backlog → completed is an invalid transition');

      const valid = await request(app1)
        .patch(`/tasks/${taskId}`)
        .set('X-User-Id', 'user-1')
        .send({ status: 'ready' });
      assert.equal(valid.status, 200);

      db1.close();
    }

    // --- Second application instance on the same database file ("restart") ---
    {
      const db2 = openDatabase(dbPath);
      const app2 = appWith(db2, dbPath);

      // #2: the Task remains associated with Alice after restart.
      const getRes = await request(app2).get(`/tasks/${taskId}`).set('X-User-Id', 'user-1');
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.task.id, taskId);
      assert.equal(getRes.body.task.assigneeAgentId, aliceId, 'still assigned to Alice after restart');
      assert.equal(getRes.body.task.status, 'ready', 'the applied transition persists');
      assert.equal(getRes.body.task.priority, 'high');

      const listRes = await request(app2)
        .get(`/projects/${projectId}/tasks`)
        .set('X-User-Id', 'user-1');
      assert.deepEqual(
        listRes.body.tasks.map((t: { id: string }) => t.id),
        [taskId],
      );

      db2.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});
