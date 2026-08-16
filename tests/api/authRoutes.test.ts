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
 * Auth router tests: first-run setup, cookie login/logout, session status,
 * legacy local-pi data adoption, and the `?return=` redirect guard.
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
  });
  return { app, labService, userService: auth.userService, sessionStore: auth.sessionStore };
}

/** Logs a user in via the form endpoint and returns the session cookie. */
async function loginCookie(app: ReturnType<typeof testApp>['app'], username: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .type('form')
    .send({ username, password });
  assert.equal(res.status, 302);
  const cookie = String(res.headers['set-cookie']).split(';')[0];
  assert.ok(cookie.startsWith('minilab_session='), 'login must set the session cookie');
  return cookie;
}

const PASSWORD = 'secret123';

test('GET /auth/login redirects to /setup when no user exists yet', async () => {
  const { app } = testApp();
  const res = await request(app).get('/auth/login').set('Accept', 'text/html');
  assert.equal(res.status, 302);
  assert.equal(String(res.headers.location), '/setup');
});

test('GET /auth/login renders the login form once a user exists', async () => {
  const { app, userService } = testApp();
  userService.createFirstUser({ username: 'jkl', password: PASSWORD });
  const res = await request(app).get('/auth/login').set('Accept', 'text/html');
  assert.equal(res.status, 200);
  assert.match(res.text, /登录 MiniLab/);
  assert.match(res.text, /name="username"/);
  assert.match(res.text, /name="password"/);
});

test('POST /auth/login authenticates, sets a session cookie, and respects ?return=', async () => {
  const { app, userService } = testApp();
  userService.createFirstUser({ username: 'jkl', password: PASSWORD });
  const res = await request(app)
    .post('/auth/login')
    .type('form')
    .send({ username: 'jkl', password: PASSWORD, return: '/labs/abc/dashboard' });
  assert.equal(res.status, 302);
  assert.equal(String(res.headers.location), '/labs/abc/dashboard');
  const setCookie = String(res.headers['set-cookie']);
  assert.match(setCookie, /^minilab_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  // the session resolves on a later request
  const cookie = setCookie.split(';')[0];
  const status = await request(app).get('/auth/status').set('Cookie', cookie);
  assert.equal(status.body.authenticated, true);
  assert.equal(status.body.user.username, 'jkl');
});

test('POST /auth/login rejects a wrong password without issuing a cookie', async () => {
  const { app, userService } = testApp();
  userService.createFirstUser({ username: 'jkl', password: PASSWORD });
  const res = await request(app)
    .post('/auth/login')
    .type('form')
    .send({ username: 'jkl', password: 'wrong-password' });
  assert.equal(res.status, 302);
  assert.match(String(res.headers.location), /^\/auth\/login\?return=%2F&error=/);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('POST /auth/login requires both fields', async () => {
  const { app, userService } = testApp();
  userService.createFirstUser({ username: 'jkl', password: PASSWORD });
  const res = await request(app).post('/auth/login').type('form').send({ username: 'jkl' });
  assert.equal(res.status, 302);
  assert.match(String(res.headers.location), /error=/);
});

test('POST /auth/login guards against open redirect via return=', async () => {
  const { app, userService } = testApp();
  userService.createFirstUser({ username: 'jkl', password: PASSWORD });
  const absolute = await request(app)
    .post('/auth/login')
    .type('form')
    .send({ username: 'jkl', password: PASSWORD, return: 'https://evil.example/phish' });
  assert.equal(absolute.status, 302);
  assert.equal(String(absolute.headers.location), '/');
  const protocolRelative = await request(app)
    .post('/auth/login')
    .type('form')
    .send({ username: 'jkl', password: PASSWORD, return: '//evil.example' });
  assert.equal(protocolRelative.status, 302);
  assert.equal(String(protocolRelative.headers.location), '/');
});

test('POST /auth/logout revokes the session and clears the cookie', async () => {
  const { app, userService } = testApp();
  userService.createFirstUser({ username: 'jkl', password: PASSWORD });
  const cookie = await loginCookie(app, 'jkl', PASSWORD);
  const logout = await request(app).post('/auth/logout').set('Cookie', cookie);
  assert.equal(logout.status, 302);
  assert.equal(String(logout.headers.location), '/auth/login');
  assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
  const status = await request(app).get('/auth/status').set('Cookie', cookie);
  assert.equal(status.body.authenticated, false);
});

test('GET /auth/status reports unauthenticated when there is no session', async () => {
  const { app } = testApp();
  const res = await request(app).get('/auth/status');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { authenticated: false, user: null });
});

test('GET /setup is only reachable before the first user exists', async () => {
  const { app, userService } = testApp();
  const empty = await request(app).get('/setup').set('Accept', 'text/html');
  assert.equal(empty.status, 200);
  assert.match(empty.text, /欢迎使用 MiniLab/);
  userService.createFirstUser({ username: 'jkl', password: PASSWORD });
  const blocked = await request(app).get('/setup').set('Accept', 'text/html');
  assert.equal(blocked.status, 302);
  assert.equal(String(blocked.headers.location), '/auth/login');
});

test('POST /setup creates the 0th user as owner, adopts legacy local-pi Labs, and logs in', async () => {
  const { app, labService, userService } = testApp();
  // legacy single-user data lives under the sentinel owner 'local-pi'
  const legacy = labService.createLab('local-pi', '博士规划实验室');
  const res = await request(app)
    .post('/setup')
    .set('Accept', 'text/html')
    .type('form')
    .send({ username: 'jkl', displayName: 'Kai', password: PASSWORD, passwordConfirm: PASSWORD });
  assert.equal(res.status, 302);
  assert.equal(String(res.headers.location), '/');
  const cookie = String(res.headers['set-cookie']).split(';')[0];

  // the new user now owns the adopted legacy Lab
  const status = await request(app).get('/auth/status').set('Cookie', cookie);
  assert.equal(status.body.authenticated, true);
  const ownerId = status.body.user.id as string;
  assert.equal(labService.listLabs(ownerId).some((lab) => lab.id === legacy.id), true);
  assert.equal(labService.listLabs('local-pi').length, 0);
  // and it is the single owner-role account
  assert.equal(userService.countUsers(), 1);
});

test('POST /setup refuses when a user already exists', async () => {
  const { app, userService } = testApp();
  userService.createFirstUser({ username: 'jkl', password: PASSWORD });
  const res = await request(app)
    .post('/setup')
    .type('form')
    .send({ username: 'other', password: PASSWORD, passwordConfirm: PASSWORD });
  assert.equal(res.status, 302);
  assert.equal(String(res.headers.location), '/auth/login');
});

test('POST /setup rejects a password mismatch with a flash error', async () => {
  const { app } = testApp();
  const res = await request(app)
    .post('/setup')
    .type('form')
    .send({ username: 'jkl', password: PASSWORD, passwordConfirm: 'different' });
  assert.equal(res.status, 302);
  assert.match(String(res.headers.location), /^\/setup\?error=/);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('POST /setup rejects a weak password', async () => {
  const { app } = testApp();
  const res = await request(app)
    .post('/setup')
    .type('form')
    .send({ username: 'jkl', password: '123', passwordConfirm: '123' });
  assert.equal(res.status, 302);
  assert.match(String(res.headers.location), /^\/setup\?error=/);
});
