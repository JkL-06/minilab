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
 * Acceptance criteria (SPEC-003):
 *  1. A Project persists across application restart.
 *  2. A Project's stage must be a supported ResearchStage.
 *  3. Cross-lab access is rejected.
 *  4. Project objective changes are recorded with an update timestamp.
 */
test('acceptance: a project survives restart, stage is validated, and cross-lab access is rejected', async () => {
  const dbPath = tempDbPath();
  try {
    let labId: string;
    let projectId: string;

    // --- First application instance ---
    {
      const db1 = openDatabase(dbPath);
      const app1 = appWith(db1, dbPath);

      const labRes = await request(app1)
        .post('/labs')
        .set('X-User-Id', 'user-1')
        .send({ name: 'Lab' });
      assert.equal(labRes.status, 201);
      labId = labRes.body.lab.id;

      const createRes = await request(app1)
        .post(`/labs/${labId}/projects`)
        .set('X-User-Id', 'user-1')
        .send({ title: 'Memory & Decision', stage: 'survey', status: 'active' });

      assert.equal(createRes.status, 201);
      assert.ok(createRes.body.project.id, 'persistent project id returned on create');
      assert.equal(createRes.body.project.labId, labId, 'project belongs to exactly one lab');
      projectId = createRes.body.project.id;

      // #2: stage must be a supported ResearchStage — rejected before any write.
      const badStage = await request(app1)
        .post(`/labs/${labId}/projects`)
        .set('X-User-Id', 'user-1')
        .send({ title: 'Invalid', stage: 'not-a-stage' });
      assert.equal(badStage.status, 400);

      // #4: an objective change is recorded with an update timestamp.
      const patchRes = await request(app1)
        .patch(`/projects/${projectId}`)
        .set('X-User-Id', 'user-1')
        .send({ objective: 'Focus on working memory.' });
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.body.project.objective, 'Focus on working memory.');
      assert.ok(patchRes.body.project.updatedAt);

      db1.close();
    }

    // --- Second application instance on the same database file ("restart") ---
    {
      const db2 = openDatabase(dbPath);
      const app2 = appWith(db2, dbPath);

      const getRes = await request(app2)
        .get(`/projects/${projectId}`)
        .set('X-User-Id', 'user-1');
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.project.id, projectId);
      assert.equal(getRes.body.project.title, 'Memory & Decision');
      assert.equal(getRes.body.project.stage, 'survey');
      assert.equal(getRes.body.project.status, 'active');
      assert.equal(
        getRes.body.project.objective,
        'Focus on working memory.',
        'the objective change and its timestamp survive restart',
      );
      assert.ok(getRes.body.project.updatedAt, 'update timestamp persisted');

      const listRes = await request(app2)
        .get(`/labs/${labId}/projects`)
        .set('X-User-Id', 'user-1');
      assert.deepEqual(
        listRes.body.projects.map((p: { id: string }) => p.id),
        [projectId],
      );

      // #3: cross-lab access is rejected.
      const crossLab = await request(app2)
        .get(`/projects/${projectId}`)
        .set('X-User-Id', 'user-2');
      assert.equal(crossLab.status, 403, 'cross-lab access must be rejected');

      db2.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});
