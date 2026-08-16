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

const USER = 'user-1';
const OTHER = 'user-2';

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
  const app = createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway: gateway, agentRuntime: runtime, memoryService, artifactService, meetingService, dashboardService, ...testAuthDeps() });
  return { app, labService, agentService };
}

async function createLab(app: ReturnType<typeof testApp>['app'], user = USER) {
  const res = await request(app).post('/labs').set('X-User-Id', user).send({ name: 'Lab' });
  assert.equal(res.status, 201);
  return res.body.lab.id as string;
}

test('POST /labs/:labId/agents hires Alice and returns a persistent agent_id', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice', specialization: 'memory', role: 'phd_researcher' });

  assert.equal(res.status, 201);
  assert.ok(res.body.agent.id, 'persistent agent_id returned');
  assert.equal(res.body.agent.labId, labId, 'agent belongs to exactly one lab');
  assert.equal(res.body.agent.name, 'Alice');
  assert.equal(res.body.agent.role, 'phd_researcher');
  assert.equal(res.body.agent.status, 'active');
  assert.equal(res.body.agent.modelConfigId, null);
  assert.match(res.body.agent.createdAt, /Z$/);
});

test('POST /labs/:labId/agents rejects an unknown lab and a non-owner', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const noLab = await request(app)
    .post('/labs/no-such-lab/agents')
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });
  assert.equal(noLab.status, 404);

  const notOwner = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', OTHER)
    .send({ name: 'Alice' });
  assert.equal(notOwner.status, 403);
  assert.equal(notOwner.body.error.code, 'FORBIDDEN');
});

test('POST /labs/:labId/agents rejects an empty name', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: '' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /labs/:labId/agents rejects provider-secret fields (SPEC-002 #5)', async () => {
  const { app, agentService } = testApp();
  const labId = await createLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice', api_key: 'sk-super-secret', modelConfigId: 'mc-1' });

  assert.equal(res.status, 400, 'secret fields must be rejected, not stored');
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.equal(agentService.listAgents(USER, labId).length, 0, 'no agent was created');
});

test('POST /labs/:labId/agents requires an authenticated user', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const res = await request(app).post(`/labs/${labId}/agents`).send({ name: 'Alice' });

  assert.equal(res.status, 401);
});

test('GET /labs/:labId/agents lists the lab’s agents', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  await request(app).post(`/labs/${labId}/agents`).set('X-User-Id', USER).send({ name: 'Alice' });
  await request(app).post(`/labs/${labId}/agents`).set('X-User-Id', USER).send({ name: 'Bob' });

  const res = await request(app).get(`/labs/${labId}/agents`).set('X-User-Id', USER);

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.agents.map((a: { name: string }) => a.name).sort(),
    ['Alice', 'Bob'],
  );
});

test('GET /labs/:labId/agents forbids a non-owner', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const res = await request(app).get(`/labs/${labId}/agents`).set('X-User-Id', OTHER);

  assert.equal(res.status, 403);
});

test('GET /agents/:agentId returns the agent for its lab’s owner', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  const created = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });

  const res = await request(app)
    .get(`/agents/${created.body.agent.id}`)
    .set('X-User-Id', USER);

  assert.equal(res.status, 200);
  assert.equal(res.body.agent.id, created.body.agent.id);
  assert.equal(res.body.agent.name, 'Alice');
});

test('GET /agents/:agentId rejects cross-lab access (SPEC-002 #4)', async () => {
  const { app } = testApp();
  const myLabId = await createLab(app);
  const otherLabId = await createLab(app, OTHER);
  const alice = await request(app)
    .post(`/labs/${otherLabId}/agents`)
    .set('X-User-Id', OTHER)
    .send({ name: 'Alice' });

  const res = await request(app)
    .get(`/agents/${alice.body.agent.id}`)
    .set('X-User-Id', USER);

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.ok(myLabId.length > 0);
});

test('GET /agents/:agentId returns 404 for an unknown agent', async () => {
  const { app } = testApp();

  const res = await request(app).get('/agents/does-not-exist').set('X-User-Id', USER);

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('PATCH /agents/:agentId updates fields and deactivates via status (SPEC-002 #6)', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  const created = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });

  const res = await request(app)
    .patch(`/agents/${created.body.agent.id}`)
    .set('X-User-Id', USER)
    .send({ status: 'inactive', specialization: 'decision-making' });

  assert.equal(res.status, 200);
  assert.equal(res.body.agent.status, 'inactive');
  assert.equal(res.body.agent.specialization, 'decision-making');

  // Record retained: still retrievable.
  const after = await request(app)
    .get(`/agents/${created.body.agent.id}`)
    .set('X-User-Id', USER);
  assert.equal(after.status, 200);
  assert.equal(after.body.agent.status, 'inactive');
});

test('PATCH /agents/:agentId rejects provider-secret fields (SPEC-002 #5)', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  const created = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });

  const res = await request(app)
    .patch(`/agents/${created.body.agent.id}`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice B', api_key: 'sk-secret' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /agents/:agentId rejects a non-owner and an unknown agent', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  const created = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });

  const notOwner = await request(app)
    .patch(`/agents/${created.body.agent.id}`)
    .set('X-User-Id', OTHER)
    .send({ name: 'X' });
  assert.equal(notOwner.status, 403);

  const missing = await request(app)
    .patch('/agents/does-not-exist')
    .set('X-User-Id', USER)
    .send({ name: 'X' });
  assert.equal(missing.status, 404);
});

test('PATCH /agents/:agentId rejects an empty body and an invalid status', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  const created = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });

  const empty = await request(app)
    .patch(`/agents/${created.body.agent.id}`)
    .set('X-User-Id', USER)
    .send({});
  assert.equal(empty.status, 400);

  const badStatus = await request(app)
    .patch(`/agents/${created.body.agent.id}`)
    .set('X-User-Id', USER)
    .send({ status: 'retired' });
  assert.equal(badStatus.status, 400);
});
