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
import { MemoryService } from '../../src/application/memoryService';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { ModelConfigService } from '../../src/application/modelConfigService';
import { ModelGatewayService } from '../../src/application/modelGateway';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { openDatabase, type MiniLabDb } from '../../src/infrastructure/db/database';
import { SqliteAgentRepository } from '../../src/infrastructure/db/sqliteAgentRepository';
import { SqliteAgentRunRepository } from '../../src/infrastructure/db/sqliteAgentRunRepository';
import { SqliteArtifactRepository } from '../../src/infrastructure/db/sqliteArtifactRepository';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteMemoryRepository } from '../../src/infrastructure/db/sqliteMemoryRepository';
import { SqliteModelConfigRepository } from '../../src/infrastructure/db/sqliteModelConfigRepository';
import { SqliteProjectRepository } from '../../src/infrastructure/db/sqliteProjectRepository';
import { SqliteTaskRepository } from '../../src/infrastructure/db/sqliteTaskRepository';
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

const USER = 'user-1';

/**
 * Acceptance criteria (SPEC-008):
 *  1. A completed Agent run creates an Artifact.
 *  2. The Artifact remains accessible after a restart.
 *  3. The Artifact is linked to its Project.
 *  4. Version metadata is preserved.
 *  5. Transcript text is not the only storage location for research output.
 */
test('acceptance: a run creates an artifact that survives restart, stays linked, and revises', async () => {
  const dbPath = tempDbPath();
  try {
    let aliceId: string;
    let projectId: string;
    let artifactId: string;

    // --- First application instance ---
    {
      const db1 = openDatabase(dbPath);
      const app1 = appWith(db1, dbPath);

      const labRes = await request(app1).post('/labs').set('X-User-Id', USER).send({ name: 'Lab' });
      assert.equal(labRes.status, 201);
      const labId = labRes.body.lab.id as string;

      const aliceRes = await request(app1)
        .post(`/labs/${labId}/agents`)
        .set('X-User-Id', USER)
        .send({ name: 'Alice' });
      aliceId = aliceRes.body.agent.id as string;

      const projRes = await request(app1)
        .post(`/labs/${labId}/projects`)
        .set('X-User-Id', USER)
        .send({ title: 'Evidence survey' });
      projectId = projRes.body.project.id as string;

      const configRes = await request(app1)
        .post(`/labs/${labId}/model-configs`)
        .set('X-User-Id', USER)
        .send({ name: 'Mock', provider: 'mock', model: 'mock-a' });
      const configId = configRes.body.modelConfig.id as string;

      await request(app1).patch(`/agents/${aliceId}`).set('X-User-Id', USER).send({ modelConfigId: configId });

      const taskRes = await request(app1)
        .post(`/projects/${projectId}/tasks`)
        .set('X-User-Id', USER)
        .send({ title: 'Map the evidence base.', assigneeAgentId: aliceId });
      const taskId = taskRes.body.task.id as string;

      for (const status of ['ready', 'running']) {
        const move = await request(app1)
          .patch(`/tasks/${taskId}`)
          .set('X-User-Id', USER)
          .send({ status });
        assert.equal(move.status, 200);
      }

      // The Agent executes the task once; the run materializes an Artifact
      // (acceptance #1) and the result carries the created id.
      const runRes = await request(app1)
        .post(`/agents/${aliceId}/runs`)
        .set('X-User-Id', USER)
        .send({ taskId, instruction: 'Map the evidence base.' });
      assert.equal(runRes.status, 201);
      assert.equal(runRes.body.run.status, 'succeeded');
      artifactId = runRes.body.run.result.artifact_proposals[0].id as string;
      assert.ok(artifactId, 'run result carries the created artifact id');

      // The artifact is immediately readable and Project-linked (acceptance #3, #5).
      const getRes = await request(app1).get(`/artifacts/${artifactId}`).set('X-User-Id', USER);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.artifact.projectId, projectId);
      assert.equal(getRes.body.artifact.version, 1);
      assert.ok(getRes.body.artifact.content.length > 0, 'content is in the artifact row, not just the transcript');

      const listRes = await request(app1)
        .get(`/projects/${projectId}/artifacts`)
        .set('X-User-Id', USER);
      assert.equal(listRes.body.artifacts.length, 1);

      db1.close();
    }

    // --- Second application instance on the same database file ("restart") ---
    {
      const db2 = openDatabase(dbPath);
      const app2 = appWith(db2, dbPath);

      // The Artifact remains accessible after the restart (acceptance #2).
      const getRes = await request(app2).get(`/artifacts/${artifactId}`).set('X-User-Id', USER);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.artifact.id, artifactId);
      assert.equal(getRes.body.artifact.projectId, projectId, 'still linked to its Project (acceptance #3)');
      assert.equal(getRes.body.artifact.version, 1, 'version metadata preserved (acceptance #4)');
      assert.ok(getRes.body.artifact.content.length > 0);

      const listRes = await request(app2)
        .get(`/projects/${projectId}/artifacts`)
        .set('X-User-Id', USER);
      assert.equal(listRes.body.artifacts.length, 1, 'visible from its Project after restart');

      // A PI revision after restart bumps the version on the reopened database.
      const revRes = await request(app2)
        .post(`/artifacts/${artifactId}/revisions`)
        .set('X-User-Id', USER)
        .send({ content: 'Revised after restart.', type: 'report' });
      assert.equal(revRes.status, 201);
      assert.equal(revRes.body.artifact.version, 2);

      const afterRev = await request(app2)
        .get(`/projects/${projectId}/artifacts`)
        .set('X-User-Id', USER);
      assert.equal(afterRev.body.artifacts.length, 2, 'both versions are durable sibling rows');

      db2.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});
