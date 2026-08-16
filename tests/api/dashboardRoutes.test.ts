import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';
import { testAuthDeps } from '../support/testAuth';

import { createApp } from '../../src/api/app';
import { AgentService } from '../../src/application/agentService';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { LabService } from '../../src/application/labService';
import { MemoryService } from '../../src/application/memoryService';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryMemoryRepository } from '../support/inMemoryMemoryRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';
import { testAgentRuntime } from '../support/testAgentRuntime';
import { testDashboardService } from '../support/testDashboardService';
import { testMeetingService } from '../support/testMeetingService';
import { testModelInfra } from '../support/testModelGateway';
import { inMemoryDecisionRepository } from '../support/inMemoryDecisionRepository';
import { inMemoryMeetingRepository } from '../support/inMemoryMeetingRepository';
import type { MockProviderAdapter } from '../../src/infrastructure/models/adapters/mockProviderAdapter';

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
  const infra = testModelInfra(labRepo);
  const { runtime, artifactService, artifacts, runs } = testAgentRuntime({
    agentRepo,
    labRepo,
    projectRepo,
    taskRepo,
    modelConfigService: infra.modelConfigService,
    gateway: infra.gateway,
  });
  const memoryService = new MemoryService(inMemoryMemoryRepository(), labRepo, agentRepo, projectRepo, new KeywordMemorySearch());
  const meetings = inMemoryMeetingRepository();
  const decisions = inMemoryDecisionRepository();
  const meetingService = testMeetingService({ projectRepo, labRepo, agentRepo, taskRepo, artifacts, taskService, memoryService, meetings, decisions });
  const dashboardService = testDashboardService({ labRepo, agentRepo, projectRepo, taskRepo, artifacts, meetings, decisions, runs });
  const auth = testAuthDeps();
  const app = createApp({ labService, agentService, projectService, taskService, modelConfigService: infra.modelConfigService, modelGateway: infra.gateway, agentRuntime: runtime, memoryService, artifactService, meetingService, dashboardService, ...auth });
  return { app, labService, mock: infra.mock, runs, userService: auth.userService };
}

type World = {
  labId: string;
  aliceId: string;
  bobId: string;
  projectId: string;
  blockedTaskId: string;
};

/**
 * Builds a Lab with Alice (persistent identity), a Project, and one *blocked*
 * task whose run carries a `questions_for_pi` entry and materializes an
 * Artifact — everything the dashboard sections need, through the real API and
 * the real (scripted mock) runtime.
 */
async function createWorld(app: ReturnType<typeof testApp>['app'], mock: MockProviderAdapter): Promise<World> {
  const labRes = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Cognitive Lab' });
  assert.equal(labRes.status, 201);
  const labId = labRes.body.lab.id as string;

  const aliceRes = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice', role: 'phd_researcher', specialization: 'working memory' });
  assert.equal(aliceRes.status, 201);
  const aliceId = aliceRes.body.agent.id as string;

  const bobRes = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Bob', role: 'literature_reviewer' });
  assert.equal(bobRes.status, 201);
  const bobId = bobRes.body.agent.id as string;

  const projRes = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: 'WM survey', status: 'active', stage: 'survey' });
  assert.equal(projRes.status, 201);
  const projectId = projRes.body.project.id as string;

  const cfgRes = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'mock-a', provider: 'mock', model: 'mock-a' });
  assert.equal(cfgRes.status, 201);
  const configId = cfgRes.body.modelConfig.id as string;

  const bindRes = await request(app).patch(`/agents/${aliceId}`).set('X-User-Id', USER).send({ modelConfigId: configId });
  assert.equal(bindRes.status, 200);

  const taskRes = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'Map evidence', assigneeAgentId: aliceId });
  assert.equal(taskRes.status, 201);
  const blockedTaskId = taskRes.body.task.id as string;
  for (const status of ['ready', 'running']) {
    const move = await request(app).patch(`/tasks/${blockedTaskId}`).set('X-User-Id', USER).send({ status });
    assert.equal(move.status, 200);
  }

  // Script the mock to propose `blocked` + a question + one artifact.
  mock.onCall(() => ({
    content: JSON.stringify({
      summary: 'Blocked pending PI input.',
      task_status: 'blocked',
      artifact_proposals: [
        { title: 'Evidence map', content: 'Map of 40 studies.', type: 'map' },
      ],
      findings: [],
      questions_for_pi: [{ question: 'Should we prioritize individual differences?' }],
      suggested_tasks: [],
      memory_candidates: [],
    }),
    provider: 'mock',
    model: 'mock-a',
    finishReason: 'stop',
    usage: { inputTokens: 3, outputTokens: 6 },
  }));
  const runRes = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId: blockedTaskId, instruction: 'Map the evidence', maxTokens: 2048 });
  assert.equal(runRes.status, 201);
  assert.equal(runRes.body.run.status, 'succeeded');

  // A Meeting + Decision for the "recent decisions" and "meeting entry point" sections.
  const meetRes = await request(app)
    .post(`/projects/${projectId}/meetings`)
    .set('X-User-Id', USER)
    .send({ title: 'Sprint sync', agenda: 'Review the plan.', participantAgentIds: [aliceId, bobId] });
  assert.equal(meetRes.status, 201);
  const meetingId = meetRes.body.meeting.id as string;
  const decRes = await request(app)
    .post(`/meetings/${meetingId}/decisions`)
    .set('X-User-Id', USER)
    .send({ statement: 'Survey first.', rationale: 'Thin evidence base.' });
  assert.equal(decRes.status, 201);

  return { labId, aliceId, bobId, projectId, blockedTaskId };
}

test('GET /labs/:labId/dashboard serves the default HTML page with every section (acceptance #1, #2, #3, #4)', async () => {
  const { app, mock } = testApp();
  const world = await createWorld(app, mock);

  const res = await request(app).get(`/labs/${world.labId}/dashboard`).set('X-User-Id', USER);
  assert.equal(res.status, 200);
  assert.match(String(res.headers['content-type']), /text\/html/);

  const html = res.text;
  // 1. active Projects with stage/status.
  assert.match(html, /进行中的项目/);
  assert.match(html, /WM survey/);
  assert.match(html, /综述/); // stage survey
  // 2. Agent roster — persistent identity, visually distinct cards (acceptance #4).
  assert.match(html, /成员（2）—— 持久身份/);
  assert.match(html, /data-agent-id="[^"]+"/); // identity cards, not chat messages
  assert.match(html, /phd_researcher/);
  assert.match(html, /working memory/);
  assert.match(html, /持久实验室成员/);
  // 3. blocked task visible (acceptance #2).
  assert.match(html, /需要关注的任务/);
  assert.match(html, /Map evidence/);
  assert.match(html, /阻塞/); // blocked badge (TASK_STATUS_LABELS)
  // 4. pending PI question visible (acceptance #3).
  assert.match(html, /等待你的问题/);
  assert.match(html, /Should we prioritize individual differences\?/);
  // 5-7. artifacts, decisions, meeting entry point.
  assert.match(html, /最近产物/);
  assert.match(html, /Evidence map/);
  assert.match(html, /最近决策/);
  assert.match(html, /Survey first\./);
  assert.match(html, /组会入口/);
  assert.match(html, /Sprint sync/);
  // Acceptance #5: the page states it derives from persistent state, no model call.
  assert.match(html, /不经过任何模型调用/);
});

test('dashboard voice panel follows the user voice preference', async () => {
  const t = testApp();
  const user = t.userService.createFirstUser({ username: 'voice_user', password: 'secret123' });
  const lab = t.labService.createLab(user.id, '语音实验室');

  // default: enabled → the 🎤 panel and its inline mic script are rendered
  const on = await request(t.app).get(`/labs/${lab.id}/dashboard`).set('X-User-Id', user.id);
  assert.match(on.text, /🎤 语音助手/);
  assert.match(on.text, /MiniLabVoice/);
  assert.match(on.text, /getUserMedia/);

  // disabled in the settings voice tab → panel is absent
  t.userService.updatePreferences(user.id, { voice: { enabled: false } });
  const off = await request(t.app).get(`/labs/${lab.id}/dashboard`).set('X-User-Id', user.id);
  assert.doesNotMatch(off.text, /🎤 语音助手/);
  assert.doesNotMatch(off.text, /MiniLabVoice/);
});

test('GET /labs/:labId/dashboard returns the same canonical dashboard as JSON (Accept: application/json)', async () => {
  const { app, mock } = testApp();
  const world = await createWorld(app, mock);

  const res = await request(app)
    .get(`/labs/${world.labId}/dashboard`)
    .set('X-User-Id', USER)
    .set('Accept', 'application/json');
  assert.equal(res.status, 200);
  assert.match(String(res.headers['content-type']), /application\/json/);

  const d = res.body.dashboard;
  assert.equal(d.lab.name, 'Cognitive Lab');
  assert.equal(d.projects[0].title, 'WM survey');
  assert.equal(d.projects[0].status, 'active');
  assert.equal(d.projects[0].stage, 'survey');
  assert.ok(d.attentionTasks.some((t: { id: string; status: string }) => t.id === world.blockedTaskId && t.status === 'blocked'), 'blocked task in JSON feed (acceptance #2)');
  assert.deepEqual(d.questionsForPi.map((q: { question: string }) => q.question), ['Should we prioritize individual differences?'], 'pending question in JSON feed (acceptance #3)');
  assert.ok(d.recentArtifacts.some((a: { title: string }) => a.title === 'Evidence map'));
  assert.ok(d.recentDecisions.some((x: { statement: string }) => x.statement === 'Survey first.'));
  assert.ok(d.meetings.some((m: { title: string }) => m.title === 'Sprint sync'));
  const alice = d.agents.find((a: { id: string }) => a.id === world.aliceId);
  assert.equal(alice.specialization, 'working memory', 'persistent identity in the JSON feed (acceptance #4)');
});

test('GET / renders the Today / Lab Pulse page (four ordered blocks)', async () => {
  const { app, mock } = testApp();
  const world = await createWorld(app, mock);

  // A `review` task (waiting on the PI) so the ⏳ 等待 PI label is exercised.
  const reviewRes = await request(app)
    .post(`/projects/${world.projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'Stakeholder Q&A', assigneeAgentId: world.aliceId });
  assert.equal(reviewRes.status, 201);
  const reviewTaskId = reviewRes.body.task.id as string;
  for (const status of ['ready', 'running', 'review']) {
    const move = await request(app).patch(`/tasks/${reviewTaskId}`).set('X-User-Id', USER).send({ status });
    assert.equal(move.status, 200);
  }

  const res = await request(app).get('/').set('X-User-Id', USER);
  assert.equal(res.status, 200);
  assert.match(String(res.headers['content-type']), /text\/html/);

  const html = res.text;
  // S1 order: Needs your attention → Lab progress → People → Today schedule.
  assert.match(html, /需要你关注/);
  assert.match(html, /实验室进度/);
  assert.match(html, /谁在干什么/);
  assert.match(html, /今日安排/);
  // attention: the blocked + review tasks and the PI question surface.
  assert.match(html, /Map evidence/);
  assert.match(html, /阻塞/); // taskStatusLabel('blocked')
  assert.match(html, /⏳ 等待 PI/); // taskStatusLabel('review') — waiting on the PI
  assert.match(html, /Stakeholder Q&amp;A/); // & is HTML-escaped
  assert.match(html, /Should we prioritize individual differences\?/);
  // lab progress: active project with a derived progress bar.
  assert.match(html, /WM survey/);
  assert.match(html, /任务完成/);
  // people: Alice holds the blocked task → no Doing → idle hint.
  assert.match(html, /Alice/);
  assert.match(html, /没有 Doing 任务/);
  // today schedule: the fixture meeting has no startedAt → nothing scheduled today.
  assert.match(html, /今天没有组会安排/);
  // the global sidebar IA is present with Today active.
  assert.match(html, /class="nav-item active"/);
  assert.match(html, /\/projects">/);
});

test('GET / shows a create-your-first-Lab page when the user has no Labs', async () => {
  const { app } = testApp();
  const res = await request(app).get('/').set('X-User-Id', USER);
  assert.equal(res.status, 200);
  assert.match(res.text, /欢迎使用 MiniLab/);
});

test('desktop mode (MINILAB_DESKTOP=1): a plain browser is served the auth flow, not a JSON 401', async () => {
  process.env.MINILAB_DESKTOP = '1';
  try {
    const { app } = testApp();
    // 浏览器导航 GET / → 302 到登录页（而非 401 / 旧版的自动 local-pi）
    const root = await request(app).get('/').set('Accept', 'text/html');
    assert.equal(root.status, 302);
    const loginLocation = String(root.headers.location);
    assert.match(loginLocation, /^\/auth\/login\?return=/);
    // users 表为空 → 登录页再 302 到首次设置
    const setupRedirect = await request(app).get(loginLocation).set('Accept', 'text/html');
    assert.equal(setupRedirect.status, 302);
    assert.match(String(setupRedirect.headers.location), /^\/setup$/);
    // 设置页是可用 HTML（而非 JSON 错误）
    const setupPage = await request(app).get('/setup').set('Accept', 'text/html');
    assert.equal(setupPage.status, 200);
    assert.match(setupPage.text, /欢迎使用 MiniLab/);
  } finally {
    delete process.env.MINILAB_DESKTOP;
  }
});

test('desktop mode: a browser session still cannot open another owner\'s Lab (ownership enforced)', async () => {
  process.env.MINILAB_DESKTOP = '1';
  try {
    const { app, mock } = testApp();
    const world = await createWorld(app, mock);
    // 首次设置创建 0 号用户并建立会话（此用户不是 world 的 Lab 所有者）
    const setup = await request(app)
      .post('/setup')
      .set('Accept', 'text/html')
      .type('form')
      .send({ username: 'jkl', password: 'secret123', passwordConfirm: 'secret123' });
    assert.equal(setup.status, 302);
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    // 已登录浏览器仍受 Lab 归属校验约束：看不到另一个所有者的 Lab
    const res = await request(app)
      .get(`/labs/${world.labId}/dashboard`)
      .set('Accept', 'text/html')
      .set('Cookie', cookie);
    assert.equal(res.status, 403);
  } finally {
    delete process.env.MINILAB_DESKTOP;
  }
});

test('desktop mode still rejects unauthenticated JSON/API clients (SPEC-001 contract intact)', async () => {
  process.env.MINILAB_DESKTOP = '1';
  try {
    const { app, mock } = testApp();
    const world = await createWorld(app, mock);
    // JSON 客户端没有 x-user-id → 依旧 401，不受浏览器回退影响
    const res = await request(app).get(`/labs/${world.labId}/dashboard`).set('Accept', 'application/json');
    assert.equal(res.status, 401);
  } finally {
    delete process.env.MINILAB_DESKTOP;
  }
});

test('dashboard routes enforce auth and Lab ownership', async () => {
  const { app, mock } = testApp();
  const world = await createWorld(app, mock);

  const noAuth = await request(app).get(`/labs/${world.labId}/dashboard`);
  assert.equal(noAuth.status, 401);

  const otherUser = await request(app).get(`/labs/${world.labId}/dashboard`).set('X-User-Id', OTHER);
  assert.equal(otherUser.status, 403);

  const missing = await request(app).get('/labs/no-such-lab/dashboard').set('X-User-Id', USER);
  assert.equal(missing.status, 404);
});

test('serving the dashboard never creates a run (acceptance #5 — no LLM)', async () => {
  const { app, mock, runs } = testApp();
  const world = await createWorld(app, mock);
  const before = runs.runs.length;

  await request(app).get(`/labs/${world.labId}/dashboard`).set('X-User-Id', USER);
  await request(app)
    .get(`/labs/${world.labId}/dashboard`)
    .set('X-User-Id', USER)
    .set('Accept', 'application/json');

  assert.equal(runs.runs.length, before, 'reading the dashboard created no runs');
});
