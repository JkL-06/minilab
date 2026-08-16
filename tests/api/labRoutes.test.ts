import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';
import { testAuthDeps } from '../support/testAuth';

import { createApp } from '../../src/api/app';
import { AgentService } from '../../src/application/agentService';
import { LabService } from '../../src/application/labService';
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
  const { modelConfigService, gateway } = testModelInfra(labRepo);
  const { runtime, artifactService, artifacts } = testAgentRuntime({ agentRepo, labRepo, projectRepo, taskRepo, modelConfigService, gateway });
  const memoryService = new MemoryService(inMemoryMemoryRepository(), labRepo, agentRepo, projectRepo, new KeywordMemorySearch());
  const meetingService = testMeetingService({ projectRepo, labRepo, agentRepo, taskRepo, artifacts, taskService, memoryService });
  const dashboardService = testDashboardService({ labRepo, agentRepo, projectRepo, taskRepo, artifacts });
  return {
    app: createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway: gateway, agentRuntime: runtime, memoryService, artifactService, meetingService, dashboardService, ...testAuthDeps(labRepo) }),
    service: labService,
  };
}

const USER = 'user-1';
const OTHER = 'user-2';

test('POST /labs creates a lab and returns a persistent ID', async () => {
  const { app } = testApp();

  const res = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Neuro Lab' });

  assert.equal(res.status, 201);
  assert.ok(res.body.lab.id, 'persistent Lab ID returned');
  assert.equal(res.body.lab.ownerUserId, USER);
  assert.equal(res.body.lab.name, 'Neuro Lab');
  assert.equal(res.body.lab.description, null);
  assert.match(res.body.lab.createdAt, /Z$/);
});

test('POST /labs accepts an optional description', async () => {
  const { app } = testApp();

  const res = await request(app)
    .post('/labs')
    .set('X-User-Id', USER)
    .send({ name: 'Neuro Lab', description: 'Studying cognition' });

  assert.equal(res.status, 201);
  assert.equal(res.body.lab.description, 'Studying cognition');
});

test('POST /labs rejects an empty name', async () => {
  const { app } = testApp();

  for (const name of ['', '   ']) {
    const res = await request(app).post('/labs').set('X-User-Id', USER).send({ name });
    assert.equal(res.status, 400, `name=${JSON.stringify(name)} should be rejected`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('POST /labs rejects a missing name', async () => {
  const { app } = testApp();

  const res = await request(app).post('/labs').set('X-User-Id', USER).send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /labs requires an authenticated user', async () => {
  const { app } = testApp();

  const res = await request(app).post('/labs').send({ name: 'Lab' });

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
});

test('GET /labs lists only the current user’s labs', async () => {
  const { app } = testApp();

  await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab A' });
  await request(app).post('/labs').set('X-User-Id', OTHER).send({ name: 'Lab B' });
  await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab C' });

  const res = await request(app).get('/labs').set('X-User-Id', USER);

  assert.equal(res.status, 200);
  const names = res.body.labs.map((lab: { name: string }) => lab.name).sort();
  assert.deepEqual(names, ['Lab A', 'Lab C']);
});

test('GET /labs requires an authenticated user', async () => {
  const { app } = testApp();

  const res = await request(app).get('/labs');

  assert.equal(res.status, 401);
});

test('GET /labs/:labId returns the lab for its owner', async () => {
  const { app } = testApp();
  const created = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab A' });

  const res = await request(app).get(`/labs/${created.body.lab.id}`).set('X-User-Id', USER);

  assert.equal(res.status, 200);
  assert.equal(res.body.lab.id, created.body.lab.id);
  assert.equal(res.body.lab.name, 'Lab A');
});

test('GET /labs/:labId forbids a different user', async () => {
  const { app } = testApp();
  const created = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab A' });

  const res = await request(app).get(`/labs/${created.body.lab.id}`).set('X-User-Id', OTHER);

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('GET /labs/:labId returns 404 for an unknown lab', async () => {
  const { app } = testApp();

  const res = await request(app).get('/labs/does-not-exist').set('X-User-Id', USER);

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('PATCH /labs/:labId updates name and description', async () => {
  const { app } = testApp();
  const created = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Before' });

  const res = await request(app)
    .patch(`/labs/${created.body.lab.id}`)
    .set('X-User-Id', USER)
    .send({ name: 'After', description: 'renewed' });

  assert.equal(res.status, 200);
  assert.equal(res.body.lab.name, 'After');
  assert.equal(res.body.lab.description, 'renewed');
  assert.ok(
    Date.parse(res.body.lab.updatedAt) >= Date.parse(created.body.lab.updatedAt),
    'updatedAt should not go backwards after PATCH',
  );
});

test('PATCH /labs/:labId clears description when null is sent', async () => {
  const { app } = testApp();
  const created = await request(app)
    .post('/labs')
    .set('X-User-Id', USER)
    .send({ name: 'Lab', description: 'old' });

  const res = await request(app)
    .patch(`/labs/${created.body.lab.id}`)
    .set('X-User-Id', USER)
    .send({ description: null });

  assert.equal(res.status, 200);
  assert.equal(res.body.lab.description, null);
});

test('PATCH /labs/:labId forbids a different user', async () => {
  const { app } = testApp();
  const created = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab' });

  const res = await request(app)
    .patch(`/labs/${created.body.lab.id}`)
    .set('X-User-Id', OTHER)
    .send({ name: 'Hijacked' });

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('PATCH /labs/:labId returns 404 for an unknown lab', async () => {
  const { app } = testApp();

  const res = await request(app)
    .patch('/labs/does-not-exist')
    .set('X-User-Id', USER)
    .send({ name: 'X' });

  assert.equal(res.status, 404);
});

test('PATCH /labs/:labId rejects an empty body', async () => {
  const { app } = testApp();
  const created = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab' });

  const res = await request(app).patch(`/labs/${created.body.lab.id}`).set('X-User-Id', USER).send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /labs/:labId rejects an empty name', async () => {
  const { app } = testApp();
  const created = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab' });

  const res = await request(app)
    .patch(`/labs/${created.body.lab.id}`)
    .set('X-User-Id', USER)
    .send({ name: '   ' });

  assert.equal(res.status, 400);
});
