import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp } from '../../src/api/app';
import { AgentService } from '../../src/application/agentService';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { LabService } from '../../src/application/labService';
import { MemoryService } from '../../src/application/memoryService';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryDecisionRepository } from '../support/inMemoryDecisionRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryMeetingRepository } from '../support/inMemoryMeetingRepository';
import { inMemoryMemoryRepository } from '../support/inMemoryMemoryRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';
import { testAgentRuntime } from '../support/testAgentRuntime';
import { testDashboardService } from '../support/testDashboardService';
import { testMeetingService } from '../support/testMeetingService';
import { testModelInfra } from '../support/testModelGateway';

const USER = 'user-1';
const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const JSON_CLIENT = 'application/json';

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
  const { runtime, artifactService, artifacts, runs } = testAgentRuntime({
    agentRepo,
    labRepo,
    projectRepo,
    taskRepo,
    modelConfigService: infra.modelConfigService,
    gateway: infra.gateway,
  });
  const memoryService = new MemoryService(
    inMemoryMemoryRepository(),
    labRepo,
    agentRepo,
    projectRepo,
    new KeywordMemorySearch(),
  );
  const meetings = inMemoryMeetingRepository();
  const decisions = inMemoryDecisionRepository();
  const meetingService = testMeetingService({
    projectRepo,
    labRepo,
    agentRepo,
    taskRepo,
    artifacts,
    taskService,
    memoryService,
    meetings,
    decisions,
  });
  const dashboardService = testDashboardService({
    labRepo,
    agentRepo,
    projectRepo,
    taskRepo,
    artifacts,
    meetings,
    decisions,
    runs,
  });
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
  return { app, labService, taskService };
}

function locationPath(location: string, segment: number): string {
  return new URL(location, 'http://localhost').pathname.split('/')[segment] as string;
}

/** Full browser core loop built exclusively through /ui/* forms. */
async function createWorld(app: ReturnType<typeof testApp>['app']) {
  const labRes = await request(app)
    .post('/ui/labs')
    .set('X-User-Id', USER)
    .type('form')
    .send({ name: 'Browser Lab', description: 'built via the UI' });
  assert.equal(labRes.status, 302);
  const labId = locationPath(labRes.headers.location as string, 2);

  // Connect a model (mock).
  await request(app)
    .post(`/ui/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .type('form')
    .send({ name: 'mock', provider: 'mock', model: 'mock-default' })
    .expect(302);

  // Hire Alice.
  const aliceRes = await request(app)
    .post(`/ui/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .type('form')
    .send({ name: 'Alice', role: 'researcher', specialization: 'NLP' })
    .expect(302);
  const aliceId = locationPath(aliceRes.headers.location as string, 2);

  // Bind Alice to the mock config.
  const configsRes = await request(app).get(`/labs/${labId}/model-configs`).set('X-User-Id', USER);
  assert.equal(configsRes.status, 200);
  const configId = configsRes.body.modelConfigs[0].id as string;
  await request(app)
    .post(`/ui/agents/${aliceId}/model-config`)
    .set('X-User-Id', USER)
    .type('form')
    .send({ modelConfigId: configId })
    .expect(302);

  // Create a project.
  const projectRes = await request(app)
    .post(`/ui/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .type('form')
    .send({ title: 'Survey paper', objective: 'Review attention mechanisms' })
    .expect(302);
  const projectId = locationPath(projectRes.headers.location as string, 2);

  // Create a task assigned to Alice.
  const taskRes = await request(app)
    .post(`/ui/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .type('form')
    .send({ title: 'Collect baseline results', description: '3 papers', assigneeAgentId: aliceId, priority: 'high' })
    .expect(302);
  const taskId = String(taskRes.headers.location).split('#task-')[1] as string;

  // Create a meeting with Alice as participant.
  const meetingRes = await request(app)
    .post(`/ui/projects/${projectId}/meetings`)
    .set('X-User-Id', USER)
    .type('form')
    .send({ title: 'Sprint sync', agenda: 'Check progress', participantAgentIds: aliceId })
    .expect(302);
  const meetingId = locationPath(meetingRes.headers.location as string, 2);

  return { labId, aliceId, configId, projectId, taskId, meetingId };
}

test('content negotiation: browsers get HTML detail pages, JSON clients fall through', async (t) => {
  const { app } = testApp();
  const world = await createWorld(app);

  await t.test('browser GET /projects/:id renders HTML with the project title', async () => {
    const res = await request(app).get(`/projects/${world.projectId}`).set('X-User-Id', USER).set('Accept', BROWSER);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Survey paper/);
    assert.match(res.text, /Collect baseline results/);
  });

  await t.test('JSON client GET /projects/:id still gets the canonical JSON', async () => {
    const res = await request(app).get(`/projects/${world.projectId}`).set('X-User-Id', USER).set('Accept', JSON_CLIENT);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.body.project.title, 'Survey paper');
  });

  await t.test('browser GET /agents/:id renders identity + model-config form', async () => {
    const res = await request(app).get(`/agents/${world.aliceId}`).set('X-User-Id', USER).set('Accept', BROWSER);
    assert.equal(res.status, 200);
    assert.match(res.text, /Alice/);
    assert.match(res.text, /指派模型/);
    assert.match(res.text, /mock-default/);
  });

  await t.test('JSON client GET /agents/:id still gets the canonical JSON', async () => {
    const res = await request(app).get(`/agents/${world.aliceId}`).set('X-User-Id', USER).set('Accept', JSON_CLIENT);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.body.agent.name, 'Alice');
  });

  await t.test('browser GET /meetings/:id renders the meeting page', async () => {
    const res = await request(app).get(`/meetings/${world.meetingId}`).set('X-User-Id', USER).set('Accept', BROWSER);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Sprint sync/);
  });
});

test('dashboard renders the model-configs section and flash banners', async () => {
  const { app } = testApp();
  const { labId } = await createWorld(app);

  const res = await request(app)
    .get(`/labs/${labId}/dashboard?notice=%E6%A8%A1%E5%9E%8B%E5%B7%B2%E8%BF%9E%E6%8E%A5&error=bad-input`)
    .set('X-User-Id', USER)
    .set('Accept', BROWSER);
  assert.equal(res.status, 200);
  assert.match(res.text, /模型配置（1）/);
  assert.match(res.text, /mock-default/);
  assert.match(res.text, /模型已连接/);
  assert.match(res.text, /bad-input/);
  assert.match(res.text, /雇佣成员/);
  assert.match(res.text, /连接模型/);
});

test('the /ui/* forms drive the whole core loop end-to-end', async (t) => {

  await t.test('run task succeeds through the mock gateway and completes the task', async () => {
    const { app, taskService } = testApp();
    const fresh = await createWorld(app);
    // A new task starts in `backlog`; the run can only propose a legal next
    // status, so the realistic browser path moves it to `running` first.
    for (const status of ['ready', 'running']) {
      await request(app).patch(`/tasks/${fresh.taskId}`).set('X-User-Id', USER).send({ status }).expect(200);
    }
    const res = await request(app)
      .post(`/ui/tasks/${fresh.taskId}/run`)
      .set('X-User-Id', USER)
      .type('form')
      .send({ instruction: 'Run it' })
      .expect(302);
    assert.match(String(res.headers.location), /notice=/);
    assert.equal(taskService.getTask(USER, fresh.taskId).status, 'completed');
  });

  await t.test('status-change form updates status and records a notice flash', async () => {
    const { app, taskService } = testApp();
    const fresh = await createWorld(app);
    const res = await request(app)
      .post(`/ui/tasks/${fresh.taskId}/status`)
      .set('X-User-Id', USER)
      .type('form')
      .send({ status: 'ready', _return: '/projects/' })
      .expect(302);
    assert.match(String(res.headers.location), /notice=/);
    assert.equal(taskService.getTask(USER, fresh.taskId).status, 'ready');
  });

  await t.test('open-redirect protection: an external _return falls back to a same-origin path', async () => {
    const { app } = testApp();
    const fresh = await createWorld(app);
    const res = await request(app)
      .post(`/ui/tasks/${fresh.taskId}/status`)
      .set('X-User-Id', USER)
      .type('form')
      .send({ status: 'ready', _return: 'https://evil.example/phish' })
      .expect(302);
    assert.ok(!String(res.headers.location).includes('evil.example'));
  });

  await t.test('meeting lifecycle: start → decision → action item → generate task → complete', async () => {
    const { app } = testApp();
    const { meetingId } = await createWorld(app);

    await request(app).post(`/ui/meetings/${meetingId}/start`).set('X-User-Id', USER).type('form').send({}).expect(302);

    await request(app)
      .post(`/ui/meetings/${meetingId}/decisions`)
      .set('X-User-Id', USER)
      .type('form')
      .send({ statement: 'Use RAG route', rationale: 'Evidence stronger' })
      .expect(302);

    // The JSON meeting route returns the MeetingDetail directly (not wrapped).
    const before = await request(app).get(`/meetings/${meetingId}`).set('X-User-Id', USER).set('Accept', JSON_CLIENT);
    assert.equal(before.status, 200);
    const participantId = before.body.participants[0].agentId as string;

    await request(app)
      .post(`/ui/meetings/${meetingId}/action-items`)
      .set('X-User-Id', USER)
      .type('form')
      .send({ title: 'Compare 3 baselines', assigneeAgentId: participantId })
      .expect(302);

    const mid = await request(app).get(`/meetings/${meetingId}`).set('X-User-Id', USER).set('Accept', JSON_CLIENT);
    assert.equal(mid.status, 200);
    const actionItemId = mid.body.actionItems[0].id as string;
    assert.ok(actionItemId);

    await request(app)
      .post(`/ui/meetings/${meetingId}/action-items/${actionItemId}/task`)
      .set('X-User-Id', USER)
      .type('form')
      .send({})
      .expect(302);

    const completeRes = await request(app)
      .post(`/ui/meetings/${meetingId}/complete`)
      .set('X-User-Id', USER)
      .type('form')
      .send({})
      .expect(302);
    assert.match(String(completeRes.headers.location), /notice=/);

    const after = await request(app).get(`/meetings/${meetingId}`).set('X-User-Id', USER).set('Accept', JSON_CLIENT);
    assert.equal(after.status, 200);
    assert.equal(after.body.meeting.status, 'completed');
    assert.equal(after.body.resultingTaskIds.length, 1);
    assert.ok(after.body.memoryWriteIds.length >= 1);
  });

  await t.test('XSS: user-authored strings are HTML-escaped on the project page', async () => {
    const { app, labService } = testApp();
    const lab = labService.createLab(USER, 'XSS Lab');
    const projRes = await request(app)
      .post(`/ui/labs/${lab.id}/projects`)
      .set('X-User-Id', USER)
      .type('form')
      .send({ title: '<script>alert(1)</script>' })
      .expect(302);
    const projectId = locationPath(projRes.headers.location as string, 2);
    const res = await request(app).get(`/projects/${projectId}`).set('X-User-Id', USER).set('Accept', BROWSER);
    assert.ok(!res.text.includes('<script>alert(1)</script>'));
    assert.ok(res.text.includes('&lt;script&gt;'));
  });
});

test('lab export serves a Markdown bundle derived from canonical state', async () => {
  const { app } = testApp();
  const { labId } = await createWorld(app);

  const res = await request(app)
    .get(`/labs/${labId}/export`)
    .set('X-User-Id', USER)
    .set('Accept', 'text/markdown,*/*');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/markdown/);
  assert.match(res.headers['content-disposition'], /attachment/);
  assert.match(res.text, /# Browser Lab/);
  assert.match(res.text, /## 成员/);
  assert.match(res.text, /### Alice/);
  assert.match(res.text, /## 项目/);
  assert.match(res.text, /### Survey paper/);
  assert.match(res.text, /Collect baseline results/);
});
