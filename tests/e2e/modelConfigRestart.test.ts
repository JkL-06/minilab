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
 * Acceptance criteria (SPEC-005):
 *  1. The Agent runtime calls `ModelGateway`, not a provider SDK (the test
 *     endpoint drives the same gateway interface the runtime will use).
 *  5. Provider credentials are encrypted at rest and never written to logs.
 *  6. Switching provider config does not alter Agent identity or memory.
 */
test('acceptance: a model config, its encrypted credential, and the Agent binding survive restart', async () => {
  const dbPath = tempDbPath();
  try {
    let labId: string;
    let aliceId: string;
    let config1Id: string;
    let config2Id: string;

    // --- First application instance ---
    {
      const db1 = openDatabase(dbPath);
      const app1 = appWith(db1, dbPath);

      const labRes = await request(app1).post('/labs').set('X-User-Id', 'user-1').send({ name: 'Lab' });
      assert.equal(labRes.status, 201);
      labId = labRes.body.lab.id;

      // Two configs for the same provider — the switch proves identity is
      // separate from the credential/config.
      const cfg1 = await request(app1)
        .post(`/labs/${labId}/model-configs`)
        .set('X-User-Id', 'user-1')
        .send({ name: 'Mock A', provider: 'mock', model: 'mock-a', apiKey: 'sk-alpha' });
      assert.equal(cfg1.status, 201);
      assert.equal(cfg1.body.modelConfig.apiKeyConfigured, true, 'credential encrypted and reported');
      assert.ok(!JSON.stringify(cfg1.body).includes('sk-alpha'), '#5: secret never crosses the API');
      config1Id = cfg1.body.modelConfig.id;

      const cfg2 = await request(app1)
        .post(`/labs/${labId}/model-configs`)
        .set('X-User-Id', 'user-1')
        .send({ name: 'Mock B', provider: 'mock', model: 'mock-b', apiKey: 'sk-beta' });
      config2Id = cfg2.body.modelConfig.id;

      // #1: the gateway path answers deterministically against config 1.
      const test1 = await request(app1).post(`/model-configs/${config1Id}/test`).set('X-User-Id', 'user-1');
      assert.equal(test1.status, 200);
      assert.equal(test1.body.model, 'mock-a');

      // Hire Alice bound to config 1, then switch her to config 2.
      const aliceRes = await request(app1)
        .post(`/labs/${labId}/agents`)
        .set('X-User-Id', 'user-1')
        .send({ name: 'Alice', modelConfigId: config1Id });
      assert.equal(aliceRes.status, 201);
      aliceId = aliceRes.body.agent.id;
      assert.equal(aliceRes.body.agent.modelConfigId, config1Id);

      const switched = await request(app1)
        .patch(`/agents/${aliceId}`)
        .set('X-User-Id', 'user-1')
        .send({ modelConfigId: config2Id });
      assert.equal(switched.status, 200);
      assert.equal(switched.body.agent.modelConfigId, config2Id);
      // #6: switching provider config leaves identity untouched.
      assert.equal(switched.body.agent.name, 'Alice');
      assert.equal(switched.body.agent.labId, labId);
      assert.equal(switched.body.agent.role, 'researcher');
      assert.equal(switched.body.agent.specialization, null);
      assert.equal(switched.body.agent.status, 'active');

      // Cross-lab: a different user cannot test our config.
      const otherLab = await request(app1)
        .post('/labs')
        .set('X-User-Id', 'user-2')
        .send({ name: 'Other' });
      const crossLab = await request(app1)
        .post(`/model-configs/${config1Id}/test`)
        .set('X-User-Id', 'user-2');
      assert.equal(crossLab.status, 403);
      assert.equal(otherLab.status, 201);

      db1.close();
    }

    // --- Second application instance on the same database file ("restart") ---
    {
      const db2 = openDatabase(dbPath);
      const app2 = appWith(db2, dbPath);

      // The encrypted credential decrypts after restart.
      const test1 = await request(app2).post(`/model-configs/${config1Id}/test`).set('X-User-Id', 'user-1');
      assert.equal(test1.status, 200, 'config 1 still answers after restart');

      // Configs and the Agent binding survived.
      const alice = await request(app2).get(`/agents/${aliceId}`).set('X-User-Id', 'user-1');
      assert.equal(alice.status, 200);
      assert.equal(alice.body.agent.name, 'Alice');
      assert.equal(alice.body.agent.modelConfigId, config2Id, 'the switch to config 2 persists');

      const list = await request(app2).get(`/labs/${labId}/model-configs`).set('X-User-Id', 'user-1');
      assert.equal(list.status, 200);
      assert.deepEqual(
        list.body.modelConfigs.map((c: { id: string }) => c.id).sort(),
        [config1Id, config2Id].sort(),
      );
      assert.ok(!JSON.stringify(list.body).includes('sk-alpha'), 'list stays redacted after restart');

      db2.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});
