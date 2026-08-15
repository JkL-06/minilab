import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp } from '../../src/api/app';
import { AgentService } from '../../src/application/agentService';
import { LabService } from '../../src/application/labService';
import { ModelGatewayError } from '../../src/domain/errors';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';
import { testAgentRuntime } from '../support/testAgentRuntime';
import { testModelInfra } from '../support/testModelGateway';
import { MemoryService } from '../../src/application/memoryService';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { inMemoryMemoryRepository } from '../support/inMemoryMemoryRepository';
import { testDashboardService } from '../support/testDashboardService';
import { testMeetingService } from '../support/testMeetingService';

function testApp() {
  const labRepo = inMemoryLabRepository();
  const agentRepo = inMemoryAgentRepository();
  const projectRepo = inMemoryProjectRepository();
  const taskRepo = inMemoryTaskRepository();
  const labService = new LabService(labRepo);
  const agentService = new AgentService(agentRepo, labRepo);
  const projectService = new ProjectService(projectRepo, labRepo);
  const taskService = new TaskService(taskRepo, projectRepo, agentRepo, labRepo);
  const infra = testModelInfra(labRepo);
  const { runtime, artifactService, artifacts } = testAgentRuntime({ agentRepo, labRepo, projectRepo, taskRepo, modelConfigService: infra.modelConfigService, gateway: infra.gateway });
  const memoryService = new MemoryService(inMemoryMemoryRepository(), labRepo, agentRepo, projectRepo, new KeywordMemorySearch());
  const meetingService = testMeetingService({ projectRepo, labRepo, agentRepo, taskRepo, artifacts, taskService, memoryService });
  const dashboardService = testDashboardService({ labRepo, agentRepo, projectRepo, taskRepo, artifacts });
  const app = createApp({
    labService,
    agentService,
    projectService,
    taskService,
    modelConfigService: infra.modelConfigService,
    modelGateway: infra.gateway,
    agentRuntime: runtime,
    memoryService,
    artifactService,
    meetingService,
    dashboardService,
  });
  return { app, infra, labService };
}

const USER = 'user-1';
const OTHER = 'user-2';

async function withLab(app: ReturnType<typeof testApp>['app'], userId = USER) {
  const res = await request(app).post('/labs').set('X-User-Id', userId).send({ name: 'Lab' });
  return res.body.lab.id as string;
}

test('POST /labs/:labId/model-configs returns 201 with no credential anywhere (SPEC-005 #5)', async () => {
  const { app } = testApp();
  const labId = await withLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'OpenAI main', provider: 'openai_compatible', model: 'gpt-4o-mini', apiKey: 'sk-topsecret' });

  assert.equal(res.status, 201);
  assert.ok(res.body.modelConfig.id);
  assert.equal(res.body.modelConfig.apiKeyConfigured, true);
  assert.equal(res.body.modelConfig.provider, 'openai_compatible');
  assert.ok(!('apiKey' in res.body.modelConfig), 'no plaintext key field in the response');
  assert.ok(!('apiKeyEncrypted' in res.body.modelConfig), 'no ciphertext field in the response');
  assert.ok(!JSON.stringify(res.body).includes('topsecret'), 'the secret never crosses the API');
});

test('POST /labs/:labId/model-configs works without an apiKey (mock provider)', async () => {
  const { app } = testApp();
  const labId = await withLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'Mock', provider: 'mock', model: 'mock-model' });

  assert.equal(res.status, 201);
  assert.equal(res.body.modelConfig.apiKeyConfigured, false);
});

test('model-configs require authentication', async () => {
  const { app } = testApp();
  const labId = await withLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .send({ name: 'X', provider: 'mock', model: 'm' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
});

test('a non-owner cannot create a model config in another lab', async () => {
  const { app } = testApp();
  const labId = await withLab(app, OTHER);

  const res = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'X', provider: 'mock', model: 'm' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('invalid inputs are rejected before any write', async () => {
  const { app } = testApp();
  const labId = await withLab(app);

  const cases = [
    { name: 'X', provider: 'anthropic', model: 'm' }, // unsupported provider
    { name: 'X', provider: 'mock', model: '' }, // empty model
    { name: '', provider: 'mock', model: 'm' }, // empty name
    { name: 'X', provider: 'mock', model: 'm', apiKey: '' }, // empty apiKey
    { name: 'X', provider: 'mock', model: 'm', baseUrl: 'not-a-url' }, // invalid baseUrl
    { name: 'X', provider: 'mock', model: 'm', api_key: 'sk-oldname' }, // strict: wrong key name
  ];
  for (const body of cases) {
    const res = await request(app)
      .post(`/labs/${labId}/model-configs`)
      .set('X-User-Id', USER)
      .send(body);
    assert.equal(res.status, 400, `body=${JSON.stringify(body)} should be rejected`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('list and get return redacted configs scoped to the lab', async () => {
  const { app } = testApp();
  const labId = await withLab(app);
  const created = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'A', provider: 'mock', model: 'mock-a' });

  const list = await request(app).get(`/labs/${labId}/model-configs`).set('X-User-Id', USER);
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.modelConfigs.map((c: { id: string }) => c.id),
    [created.body.modelConfig.id],
  );
  for (const config of list.body.modelConfigs) {
    assert.ok(!('apiKey' in config), 'no plaintext key field in the list');
    assert.ok(!('apiKeyEncrypted' in config), 'no ciphertext field in the list');
  }
  assert.ok(!JSON.stringify(list.body).includes('apiKeyEncrypted'), 'list is fully redacted');

  const got = await request(app)
    .get(`/model-configs/${created.body.modelConfig.id}`)
    .set('X-User-Id', USER);
  assert.equal(got.status, 200);
  assert.equal(got.body.modelConfig.name, 'A');

  const missing = await request(app).get('/model-configs/does-not-exist').set('X-User-Id', USER);
  assert.equal(missing.status, 404);

  const otherLab = await withLab(app, OTHER);
  const listOther = await request(app).get(`/labs/${otherLab}/model-configs`).set('X-User-Id', OTHER);
  assert.deepEqual(listOther.body.modelConfigs, []);
});

test('PATCH updates fields and replaces or clears the credential', async () => {
  const { app } = testApp();
  const labId = await withLab(app);
  const created = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'A', provider: 'mock', model: 'mock-a', apiKey: 'sk-old' });
  const id = created.body.modelConfig.id;

  const renamed = await request(app)
    .patch(`/model-configs/${id}`)
    .set('X-User-Id', USER)
    .send({ name: 'B' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.modelConfig.name, 'B');
  assert.equal(renamed.body.modelConfig.apiKeyConfigured, true, 'key is kept when not touched');

  const replaced = await request(app)
    .patch(`/model-configs/${id}`)
    .set('X-User-Id', USER)
    .send({ apiKey: 'sk-new' });
  assert.equal(replaced.body.modelConfig.apiKeyConfigured, true);

  const cleared = await request(app)
    .patch(`/model-configs/${id}`)
    .set('X-User-Id', USER)
    .send({ apiKey: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.modelConfig.apiKeyConfigured, false, 'null clears the credential');

  const empty = await request(app).patch(`/model-configs/${id}`).set('X-User-Id', USER).send({});
  assert.equal(empty.status, 400);
});

test('the test endpoint drives the ModelGateway and returns normalized output (SPEC-005 #1/#3)', async () => {
  const { app } = testApp();
  const labId = await withLab(app);
  const created = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'Mock', provider: 'mock', model: 'mock-model' });
  const id = created.body.modelConfig.id;

  const res = await request(app).post(`/model-configs/${id}/test`).set('X-User-Id', USER);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.provider, 'mock');
  assert.equal(res.body.model, 'mock-model');
  assert.ok(res.body.content.includes('Mock reply to:'), 'mock adapter answered deterministically');
});

test('a provider failure surfaces as 502 PROVIDER_ERROR with a normalized category (SPEC-005 #4)', async () => {
  const { app, infra } = testApp();
  const labId = await withLab(app);
  const created = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'Mock', provider: 'mock', model: 'mock-model' });
  const id = created.body.modelConfig.id;

  infra.mock.onCall(() => {
    throw new ModelGatewayError('rate_limit', 'Provider rate limited the request');
  });

  const res = await request(app).post(`/model-configs/${id}/test`).set('X-User-Id', USER);
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'PROVIDER_ERROR');
  assert.equal(res.body.error.category, 'rate_limit');
});

test('a disabled config is rejected by the gateway before any provider call', async () => {
  const { app, infra } = testApp();
  const labId = await withLab(app);
  let called = false;
  infra.mock.onCall(() => {
    called = true;
    return { content: 'x', provider: 'mock', model: 'mock-model', finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0 } };
  });
  const created = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'Mock', provider: 'mock', model: 'mock-model', isEnabled: false });
  const id = created.body.modelConfig.id;

  const res = await request(app).post(`/model-configs/${id}/test`).set('X-User-Id', USER);
  assert.equal(res.status, 502);
  assert.equal(res.body.error.category, 'invalid_request');
  assert.equal(called, false);
});

test('the test endpoint enforces lab ownership', async () => {
  const { app } = testApp();
  const labId = await withLab(app, OTHER);
  const created = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', OTHER)
    .send({ name: 'Mock', provider: 'mock', model: 'mock-model' });

  const res = await request(app)
    .post(`/model-configs/${created.body.modelConfig.id}/test`)
    .set('X-User-Id', USER);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});
