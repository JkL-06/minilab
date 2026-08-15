import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp } from '../../src/api/app';
import { AgentService } from '../../src/application/agentService';
import { LabService } from '../../src/application/labService';
import { MemoryService } from '../../src/application/memoryService';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryMemoryRepository } from '../support/inMemoryMemoryRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';
import { testAgentRuntime } from '../support/testAgentRuntime';
import { testModelInfra } from '../support/testModelGateway';
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
  const memoryService = new MemoryService(
    inMemoryMemoryRepository(),
    labRepo,
    agentRepo,
    projectRepo,
    new KeywordMemorySearch(),
  );
  const meetingService = testMeetingService({ projectRepo, labRepo, agentRepo, taskRepo, artifacts, taskService, memoryService });
  const dashboardService = testDashboardService({ labRepo, agentRepo, projectRepo, taskRepo, artifacts });
  const app = createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway: gateway, agentRuntime: runtime, memoryService, artifactService, meetingService, dashboardService });
  return { app, labService, agentService, projectService };
}

async function createWorld(app: ReturnType<typeof testApp>['app'], user = USER) {
  const labRes = await request(app).post('/labs').set('X-User-Id', user).send({ name: 'Lab' });
  assert.equal(labRes.status, 201);
  const labId = labRes.body.lab.id as string;

  const aliceRes = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', user)
    .send({ name: 'Alice' });
  assert.equal(aliceRes.status, 201);
  const aliceId = aliceRes.body.agent.id as string;

  const projRes = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', user)
    .send({ title: 'Survey' });
  assert.equal(projRes.status, 201);
  const projectId = projRes.body.project.id as string;

  return { labId, aliceId, projectId };
}

test('POST /labs/:labId/memory writes scoped memory with a server-set PI author', async () => {
  const { app } = testApp();
  const { labId, aliceId } = await createWorld(app);

  const res = await request(app)
    .post(`/labs/${labId}/memory`)
    .set('X-User-Id', USER)
    .send({
      scope: 'agent',
      scopeId: aliceId,
      memoryType: 'hypothesis',
      content: 'Working-memory load may modulate outcomes.',
      sourceType: 'experiment',
      sourceId: 'exp-42',
      importance: 5,
    });

  assert.equal(res.status, 201);
  const memory = res.body.memory;
  assert.ok(memory.id);
  assert.equal(memory.labId, labId);
  assert.equal(memory.scope, 'agent');
  assert.equal(memory.scopeId, aliceId);
  assert.equal(memory.memoryType, 'hypothesis');
  assert.equal(memory.content, 'Working-memory load may modulate outcomes.');
  assert.equal(memory.sourceType, 'experiment');
  assert.equal(memory.sourceId, 'exp-42');
  assert.equal(memory.authorType, 'pi', 'author is server-set, never client-supplied');
  assert.equal(memory.authorId, USER);
  assert.equal(memory.importance, 5);
});

test('POST memory forbids a non-owner and rejects an unknown lab', async () => {
  const { app } = testApp();
  const { labId, aliceId } = await createWorld(app);

  const asOther = await request(app)
    .post(`/labs/${labId}/memory`)
    .set('X-User-Id', OTHER)
    .send({ scope: 'agent', scopeId: aliceId, content: 'x', sourceType: 'note', sourceId: 's1' });
  assert.equal(asOther.status, 403);

  const unknownLab = await request(app)
    .post('/labs/no-such-lab/memory')
    .set('X-User-Id', USER)
    .send({ scope: 'lab', content: 'x', sourceType: 'note', sourceId: 's1' });
  assert.equal(unknownLab.status, 404);
});

test('POST memory rejects invalid input: empty content, bad scope, dangling agent, lab scopeId', async () => {
  const { app } = testApp();
  const { labId } = await createWorld(app);

  const cases = [
    { scope: 'agent', scopeId: 'agent-1', content: '', sourceType: 'note', sourceId: 's1' },
    { scope: 'system', content: 'x', sourceType: 'note', sourceId: 's1' },
    { scope: 'agent', scopeId: 'no-such-agent', content: 'x', sourceType: 'note', sourceId: 's1' },
    { scope: 'lab', scopeId: 'team-1', content: 'x', sourceType: 'note', sourceId: 's1' },
  ];
  for (const body of cases) {
    const res = await request(app).post(`/labs/${labId}/memory`).set('X-User-Id', USER).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('GET /labs/:labId/memory lists memory and filters by scope', async () => {
  const { app } = testApp();
  const { labId, aliceId, projectId } = await createWorld(app);

  await request(app)
    .post(`/labs/${labId}/memory`)
    .set('X-User-Id', USER)
    .send({ scope: 'lab', content: 'Lab-wide policy: cite sources.', sourceType: 'note', sourceId: 's1' });
  await request(app)
    .post(`/labs/${labId}/memory`)
    .set('X-User-Id', USER)
    .send({ scope: 'agent', scopeId: aliceId, content: 'Alice likes tables.', sourceType: 'note', sourceId: 's2' });
  await request(app)
    .post(`/labs/${labId}/memory`)
    .set('X-User-Id', USER)
    .send({ scope: 'project', scopeId: projectId, content: 'Survey context.', sourceType: 'note', sourceId: 's3' });

  const all = await request(app).get(`/labs/${labId}/memory`).set('X-User-Id', USER);
  assert.equal(all.status, 200);
  assert.equal(all.body.memories.length, 3);

  const agentOnly = await request(app).get(`/labs/${labId}/memory?scope=agent`).set('X-User-Id', USER);
  assert.equal(agentOnly.status, 200);
  assert.equal(agentOnly.body.memories.length, 1);
  assert.equal(agentOnly.body.memories[0].scopeId, aliceId);

  const asOther = await request(app).get(`/labs/${labId}/memory`).set('X-User-Id', OTHER);
  assert.equal(asOther.status, 403, 'non-owner cannot list');
});

test('GET /labs/:labId/memory/search ranks relevant memory and returns fallback flag', async () => {
  const { app } = testApp();
  const { labId, aliceId } = await createWorld(app);

  await request(app)
    .post(`/labs/${labId}/memory`)
    .set('X-User-Id', USER)
    .send({ scope: 'agent', scopeId: aliceId, content: 'Prefers structured survey notes.', sourceType: 'interview', sourceId: 's1', importance: 2 });
  await request(app)
    .post(`/labs/${labId}/memory`)
    .set('X-User-Id', USER)
    .send({ scope: 'agent', scopeId: aliceId, content: 'The survey must include statistics.', sourceType: 'interview', sourceId: 's2', importance: 5 });

  const res = await request(app)
    .get(`/labs/${labId}/memory/search?q=survey+statistics`)
    .set('X-User-Id', USER);

  assert.equal(res.status, 200);
  assert.equal(res.body.query, 'survey statistics');
  assert.equal(res.body.fallback, false);
  assert.equal(res.body.memories.length, 2);
  assert.equal(
    res.body.memories[0].content,
    'The survey must include statistics.',
    'more relevant memory ranks first',
  );

  const missingQ = await request(app).get(`/labs/${labId}/memory/search`).set('X-User-Id', USER);
  assert.equal(missingQ.status, 400, 'q is required');

  const asOther = await request(app)
    .get(`/labs/${labId}/memory/search?q=survey`)
    .set('X-User-Id', OTHER);
  assert.equal(asOther.status, 403, 'non-owner cannot search');
});
