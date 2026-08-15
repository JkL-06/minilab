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
import { VERSION } from '../../src/version';
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
  return { app };
}

test('GET /health reports version and uptime without authentication', async () => {
  const { app } = testApp();
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.version, VERSION);
  assert.equal(typeof res.body.uptimeMs, 'number');
});

test('desktop CSRF guard rejects cross-site state changes but allows same-origin', async (t) => {
  const previous = process.env.MINILAB_DESKTOP;
  process.env.MINILAB_DESKTOP = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.MINILAB_DESKTOP;
    else process.env.MINILAB_DESKTOP = previous;
  });

  const { app } = testApp();

  await t.test('cross-origin POST (Origin mismatch) is rejected with 403', async () => {
    const res = await request(app)
      .post('/labs')
      .set('Accept', BROWSER)
      .set('Host', 'localhost')
      .set('Origin', 'https://evil.example')
      .send({ name: 'evil' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  await t.test('cross-origin POST (Referer mismatch) is rejected with 403', async () => {
    const res = await request(app)
      .post('/labs')
      .set('Accept', BROWSER)
      .set('Host', 'localhost')
      .set('Referer', 'https://evil.example/form')
      .send({ name: 'evil' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  await t.test('same-origin POST passes the guard and is served as local-pi', async () => {
    const res = await request(app)
      .post('/labs')
      .set('Accept', BROWSER)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .send({ name: 'Local Lab' });
    assert.equal(res.status, 201);
    assert.equal(res.body.lab.name, 'Local Lab');
  });

  await t.test('GET requests are not gated by the guard', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
  });

  await t.test('requests carrying x-user-id bypass the guard (SPEC-001 auth contract)', async () => {
    const res = await request(app)
      .post('/labs')
      .set('X-User-Id', USER)
      .set('Origin', 'https://evil.example')
      .send({ name: 'Api Lab' });
    assert.equal(res.status, 201);
    assert.equal(res.body.lab.name, 'Api Lab');
  });
});

test('desktop CSRF guard is a no-op outside desktop mode', async () => {
  const previous = process.env.MINILAB_DESKTOP;
  delete process.env.MINILAB_DESKTOP;
  const { app } = testApp();
  try {
    // Guard skipped → requireUser rejects the headerless request with 401.
    const res = await request(app)
      .post('/labs')
      .set('Accept', BROWSER)
      .set('Host', 'localhost')
      .set('Origin', 'https://evil.example')
      .send({ name: 'x' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  } finally {
    if (previous !== undefined) process.env.MINILAB_DESKTOP = previous;
  }
});
