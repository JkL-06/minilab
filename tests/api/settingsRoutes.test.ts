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
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryMemoryRepository } from '../support/inMemoryMemoryRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';
import { testAgentRuntime } from '../support/testAgentRuntime';
import { testDashboardService } from '../support/testDashboardService';
import { testMeetingService } from '../support/testMeetingService';
import { testModelInfra } from '../support/testModelGateway';
import { testAuthDeps } from '../support/testAuth';

/**
 * Settings center (user center) tests: the six-tab page renders, every section
 * POST persists to the user's preferences/profile, password change validates the
 * old password, and the config test action exercises the model gateway.
 */
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
  const meetingService = testMeetingService({ projectRepo, labRepo, agentRepo, taskRepo, artifacts, taskService, memoryService });
  const dashboardService = testDashboardService({ labRepo, agentRepo, projectRepo, taskRepo, artifacts, runs });
  const auth = testAuthDeps(labRepo);
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
    userService: auth.userService,
    sessionStore: auth.sessionStore,
    voiceService: auth.voiceService,
    dataDir: 'C:\\MiniLab\\data\\minilab.db',
    port: 3000,
  });
  return { app, labService, userService: auth.userService, modelConfigService: infra.modelConfigService };
}

const PASSWORD = 'secret123';
const HDR = 'X-User-Id';

function setupUser(t: ReturnType<typeof testApp>, username = 'jkl'): { userId: string } {
  const user = t.userService.createFirstUser({ username, password: PASSWORD });
  return { userId: user.id };
}

test('GET /ui/settings redirects an unauthenticated browser to login', async () => {
  const t = testApp();
  const { app } = t;
  setupUser(t);
  const res = await request(app).get('/ui/settings').set('Accept', 'text/html');
  assert.equal(res.status, 302);
  assert.match(String(res.headers.location), /^\/auth\/login\?return=/);
});

test('GET /ui/settings rejects an unauthenticated JSON client with 401', async () => {
  const t = testApp();
  const { app } = t;
  setupUser(t);
  const res = await request(app).get('/ui/settings').set('Accept', 'application/json');
  assert.equal(res.status, 401);
});

test('GET /ui/settings renders all six sections plus the sidebar settings entry', async () => {
  const t = testApp();
  const { app } = t;
  const { userId } = setupUser(t);
  const res = await request(app).get('/ui/settings').set(HDR, userId).set('Accept', 'text/html');
  assert.equal(res.status, 200);
  assert.match(res.text, /设置中心/);
  for (const label of ['常规', '个人资料', '语音', '配置', '个性化', '账户']) {
    assert.match(res.text, new RegExp(label));
  }
  // 侧边导航里的设置入口（全局 appFrame，非品牌头）
  assert.match(res.text, /\/ui\/settings"><span class="nav-icon">⚙<\/span>设置/);
  // 默认落在常规分区
  assert.match(res.text, /界面语言/);
});

test('GET /ui/settings?tab=account shows the account section (password form)', async () => {
  const t = testApp();
  const { app } = t;
  const { userId } = setupUser(t);
  const res = await request(app).get('/ui/settings?tab=account').set(HDR, userId).set('Accept', 'text/html');
  assert.equal(res.status, 200);
  assert.match(res.text, /修改密码/);
  assert.match(res.text, /name="currentPassword"/);
  assert.match(res.text, /name="newPassword"/);
});

test('POST /ui/settings/profile persists display name, avatar, and bio', async () => {
  const t = testApp();
  const { app, userService } = t;
  const { userId } = setupUser(t);
  const res = await request(app)
    .post('/ui/settings/profile')
    .set(HDR, userId)
    .type('form')
    .send({ displayName: 'Kai Li', avatar: '🧑‍🔬', bio: '博士规划研究者' });
  assert.equal(res.status, 302);
  assert.match(String(res.headers.location), /tab=profile/);
  const user = userService.getUser(userId);
  assert.equal(user.displayName, 'Kai Li');
  assert.equal(user.avatar, '🧑‍🔬');
  assert.equal(user.bio, '博士规划研究者');
});

test('POST /ui/settings/general persists language and startMinimized', async () => {
  const t = testApp();
  const { app, userService } = t;
  const { userId } = setupUser(t);
  const res = await request(app)
    .post('/ui/settings/general')
    .set(HDR, userId)
    .type('form')
    .send({ language: 'en', startMinimized: '1' });
  assert.equal(res.status, 302);
  const prefs = userService.getUser(userId).preferences.general ?? {};
  assert.equal(prefs.language, 'en');
  assert.equal(prefs.startMinimized, true);
});

test('POST /ui/settings/voice persists voice prefs and clamps an invalid speed', async () => {
  const t = testApp();
  const { app, userService } = t;
  const { userId } = setupUser(t);
  const res = await request(app)
    .post('/ui/settings/voice')
    .set(HDR, userId)
    .type('form')
    .send({ enabled: '1', ttsVoice: 'longxiaoxia', ttsSpeed: '0.8', asrLanguage: 'zh' });
  assert.equal(res.status, 302);
  const prefs = userService.getUser(userId).preferences.voice ?? {};
  assert.equal(prefs.enabled, true);
  assert.equal(prefs.ttsVoice, 'longxiaoxia');
  assert.equal(prefs.ttsSpeed, 0.8);
  assert.equal(prefs.asrLanguage, 'zh');

  // out-of-range speed is dropped rather than stored
  const bad = await request(app)
    .post('/ui/settings/voice')
    .set(HDR, userId)
    .type('form')
    .send({ ttsSpeed: '9' });
  assert.equal(bad.status, 302);
  const after = userService.getUser(userId).preferences.voice ?? {};
  assert.equal(after.ttsSpeed, 0.8);
});

test('POST /ui/settings/personalize persists theme/accent/density and rejects invalid values', async () => {
  const t = testApp();
  const { app, userService } = t;
  const { userId } = setupUser(t);
  const res = await request(app)
    .post('/ui/settings/personalize')
    .set(HDR, userId)
    .type('form')
    .send({ theme: 'dark', accentColor: 'cyan', density: 'compact' });
  assert.equal(res.status, 302);
  const prefs = userService.getUser(userId).preferences.personalize ?? {};
  assert.equal(prefs.theme, 'dark');
  assert.equal(prefs.accentColor, 'cyan');
  assert.equal(prefs.density, 'compact');

  // nonsense theme/density values are dropped, never persisted
  const bad = await request(app)
    .post('/ui/settings/personalize')
    .set(HDR, userId)
    .type('form')
    .send({ theme: 'neon', density: 'spacious' });
  assert.equal(bad.status, 302);
  const after = userService.getUser(userId).preferences.personalize ?? {};
  assert.equal(after.theme, 'dark');
  assert.equal(after.density, 'compact');
});

test('POST /ui/settings/password changes the password and rejects a wrong current one', async () => {
  const t = testApp();
  const { app, userService } = t;
  const { userId } = setupUser(t);
  // wrong current password → flash error, no change
  const wrong = await request(app)
    .post('/ui/settings/password')
    .set(HDR, userId)
    .type('form')
    .send({ currentPassword: 'nope', newPassword: 'newpass123', newPasswordConfirm: 'newpass123' });
  assert.equal(wrong.status, 302);
  assert.match(String(wrong.headers.location), /tab=account&error=/);
  assert.throws(() => userService.authenticate('jkl', 'newpass123'));

  // mismatch of the two new-password fields → error
  const mismatch = await request(app)
    .post('/ui/settings/password')
    .set(HDR, userId)
    .type('form')
    .send({ currentPassword: PASSWORD, newPassword: 'newpass123', newPasswordConfirm: 'different' });
  assert.equal(mismatch.status, 302);
  assert.match(String(mismatch.headers.location), /tab=account&error=/);

  // correct current password → new password works, old one no longer does
  const ok = await request(app)
    .post('/ui/settings/password')
    .set(HDR, userId)
    .type('form')
    .send({ currentPassword: PASSWORD, newPassword: 'newpass123', newPasswordConfirm: 'newpass123' });
  assert.equal(ok.status, 302);
  assert.match(String(ok.headers.location), /notice=/);
  userService.authenticate('jkl', 'newpass123');
  assert.throws(() => userService.authenticate('jkl', PASSWORD));
});

test('POST /ui/settings/logout forwards to the auth logout flow', async () => {
  const t = testApp();
  const { app } = t;
  const { userId } = setupUser(t);
  const res = await request(app).post('/ui/settings/logout').set(HDR, userId).type('form').send({});
  assert.equal(res.status, 302);
  assert.equal(String(res.headers.location), '/auth/logout');
});

test('POST /ui/settings/config/test flashes an error when no config id is given', async () => {
  const t = testApp();
  const { app } = t;
  const { userId } = setupUser(t);
  const res = await request(app).post('/ui/settings/config/test').set(HDR, userId).type('form').send({});
  assert.equal(res.status, 302);
  assert.match(String(res.headers.location), /tab=config&error=/);
});

test('POST /ui/settings/config/test runs the gateway and reports a success notice', async () => {
  const t = testApp();
  const { app, labService, modelConfigService } = t;
  const { userId } = setupUser(t);
  const lab = labService.createLab(userId, '测试实验室');
  const config = modelConfigService.createModelConfig(userId, lab.id, {
    name: 'qwen-plus',
    provider: 'mock',
    model: 'qwen-plus',
  });
  const res = await request(app)
    .post('/ui/settings/config/test')
    .set(HDR, userId)
    .type('form')
    .send({ modelConfigId: config.id });
  assert.equal(res.status, 302);
  // notice is URL-encoded (Chinese → %E8%BF...), so assert the prefix only
  assert.match(String(res.headers.location), /tab=config&notice=/);
});

test('POST /ui/settings/config/test rejects a config the user does not own', async () => {
  const t = testApp();
  const { app, labService, modelConfigService } = t;
  const { userId } = setupUser(t);
  // a Lab owned by the legacy 'local-pi' identity is not the current user's
  const lab = labService.createLab('local-pi', '别人的实验室');
  const config = modelConfigService.createModelConfig('local-pi', lab.id, {
    name: 'secret',
    provider: 'mock',
    model: 'm',
  });
  const res = await request(app)
    .post('/ui/settings/config/test')
    .set(HDR, userId)
    .type('form')
    .send({ modelConfigId: config.id });
  assert.equal(res.status, 302);
  assert.match(String(res.headers.location), /\/ui\/settings\?error=/);
});
