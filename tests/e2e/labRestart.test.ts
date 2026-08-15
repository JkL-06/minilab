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
 * Acceptance criteria 1 & 2 (SPEC-001):
 *  1. Given an authenticated user, creating a Lab returns a persistent Lab ID.
 *  2. After application restart, the Lab can still be retrieved.
 *
 * A single SQLite file backs two "process" instances to simulate a restart.
 */
test('acceptance: a lab created via the API survives an application restart', async () => {
  const dbPath = tempDbPath();
  try {
    let labId: string;

    // --- First application instance ---
    {
      const db1 = openDatabase(dbPath);
      const app1 = appWith(db1, dbPath);

      const createRes = await request(app1)
        .post('/labs')
        .set('X-User-Id', 'user-1')
        .send({ name: 'Durable Lab', description: 'survives restarts' });

      assert.equal(createRes.status, 201);
      assert.ok(createRes.body.lab.id, 'persistent Lab ID returned on create');
      labId = createRes.body.lab.id;

      // Shut the instance down (close its connection)
      db1.close();
    }

    // --- Second application instance on the same database file ("restart") ---
    {
      const db2 = openDatabase(dbPath);
      const app2 = appWith(db2, dbPath);

      const getRes = await request(app2).get(`/labs/${labId}`).set('X-User-Id', 'user-1');

      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.lab.id, labId);
      assert.equal(getRes.body.lab.name, 'Durable Lab');
      assert.equal(getRes.body.lab.description, 'survives restarts');

      const listRes = await request(app2).get('/labs').set('X-User-Id', 'user-1');
      assert.deepEqual(listRes.body.labs.map((lab: { id: string }) => lab.id), [labId]);

      db2.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});
