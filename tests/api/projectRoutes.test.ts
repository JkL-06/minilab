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
  return { app, projectService };
}

async function createLab(app: ReturnType<typeof testApp>['app'], user = USER) {
  const res = await request(app).post('/labs').set('X-User-Id', user).send({ name: 'Lab' });
  assert.equal(res.status, 201);
  return res.body.lab.id as string;
}

async function createProject(
  app: ReturnType<typeof testApp>['app'],
  labId: string,
  user = USER,
  body: Record<string, unknown> = { title: 'Survey' },
) {
  const res = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', user)
    .send(body);
  assert.equal(res.status, 201);
  return res.body.project as { id: string };
}

test('POST /labs/:labId/projects creates a project with defaults and a persistent id', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: 'Memory & Decision' });

  assert.equal(res.status, 201);
  assert.ok(res.body.project.id, 'persistent project id returned');
  assert.equal(res.body.project.labId, labId, 'project belongs to exactly one lab');
  assert.equal(res.body.project.title, 'Memory & Decision');
  assert.equal(res.body.project.objective, null);
  assert.equal(res.body.project.teamId, null);
  assert.equal(res.body.project.stage, 'explore');
  assert.equal(res.body.project.status, 'planned');
  assert.match(res.body.project.createdAt, /Z$/);
});

test('POST /labs/:labId/projects accepts an explicit stage, status, objective, and teamId', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({
      title: 'Survey',
      objective: 'Map the evidence base.',
      teamId: 'team-core',
      stage: 'survey',
      status: 'active',
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.project.objective, 'Map the evidence base.');
  assert.equal(res.body.project.teamId, 'team-core');
  assert.equal(res.body.project.stage, 'survey');
  assert.equal(res.body.project.status, 'active');
});

test('POST /labs/:labId/projects rejects an unsupported research stage (SPEC-003 #2)', async () => {
  const { app, projectService } = testApp();
  const labId = await createLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: 'Survey', stage: 'brainstorm' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.equal(projectService.listProjects(USER, labId).length, 0, 'no project was created');
});

test('POST /labs/:labId/projects rejects an unsupported status', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const res = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: 'Survey', status: 'draft' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /labs/:labId/projects rejects an empty title and unknown keys', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const emptyTitle = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: '' });
  assert.equal(emptyTitle.status, 400);

  const secretKey = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: 'Survey', api_key: 'sk-topsecret' });
  assert.equal(secretKey.status, 400, 'unknown keys must be rejected, not silently dropped');
  assert.equal(secretKey.body.error.code, 'VALIDATION_ERROR');
});

test('POST /labs/:labId/projects rejects an unknown lab, a non-owner, and no auth', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const noLab = await request(app)
    .post('/labs/no-such-lab/projects')
    .set('X-User-Id', USER)
    .send({ title: 'Survey' });
  assert.equal(noLab.status, 404);

  const notOwner = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', OTHER)
    .send({ title: 'Survey' });
  assert.equal(notOwner.status, 403);
  assert.equal(notOwner.body.error.code, 'FORBIDDEN');

  const noAuth = await request(app).post(`/labs/${labId}/projects`).send({ title: 'Survey' });
  assert.equal(noAuth.status, 401);
});

test('GET /labs/:labId/projects lists the lab’s projects', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  await createProject(app, labId, USER, { title: 'Survey' });
  await createProject(app, labId, USER, { title: 'Write-up' });

  const res = await request(app).get(`/labs/${labId}/projects`).set('X-User-Id', USER);

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.projects.map((p: { title: string }) => p.title).sort(),
    ['Survey', 'Write-up'],
  );
});

test('GET /labs/:labId/projects forbids a non-owner', async () => {
  const { app } = testApp();
  const labId = await createLab(app);

  const res = await request(app).get(`/labs/${labId}/projects`).set('X-User-Id', OTHER);

  assert.equal(res.status, 403);
});

test('GET /projects/:projectId returns the project for its lab’s owner', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  const project = await createProject(app, labId);

  const res = await request(app)
    .get(`/projects/${project.id}`)
    .set('X-User-Id', USER);

  assert.equal(res.status, 200);
  assert.equal(res.body.project.id, project.id);
  assert.equal(res.body.project.title, 'Survey');
});

test('GET /projects/:projectId rejects cross-lab access (SPEC-003 #3)', async () => {
  const { app } = testApp();
  const myLabId = await createLab(app);
  const otherLabId = await createLab(app, OTHER);
  const project = await createProject(app, otherLabId, OTHER);

  const res = await request(app)
    .get(`/projects/${project.id}`)
    .set('X-User-Id', USER);

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.ok(myLabId.length > 0);
});

test('GET /projects/:projectId returns 404 for an unknown project', async () => {
  const { app } = testApp();

  const res = await request(app).get('/projects/does-not-exist').set('X-User-Id', USER);

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('PATCH /projects/:projectId records an objective change with an update timestamp (SPEC-003 #4)', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  const created = await createProject(app, labId);
  const projectId = created.id;

  const res = await request(app)
    .patch(`/projects/${projectId}`)
    .set('X-User-Id', USER)
    .send({ objective: 'Focus on working memory.', stage: 'validate', status: 'active' });

  assert.equal(res.status, 200);
  assert.equal(res.body.project.objective, 'Focus on working memory.');
  assert.equal(res.body.project.stage, 'validate');
  assert.equal(res.body.project.status, 'active');
  assert.equal(res.body.project.title, 'Survey', 'unsupplied fields are untouched');
  assert.match(res.body.project.updatedAt, /Z$/, 'the update carries an ISO-8601 UTC timestamp');
});

test('PATCH /projects/:projectId rejects an unsupported stage and status (SPEC-003 #2)', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  const project = await createProject(app, labId);

  const badStage = await request(app)
    .patch(`/projects/${project.id}`)
    .set('X-User-Id', USER)
    .send({ stage: 'fabricate' });
  assert.equal(badStage.status, 400);
  assert.equal(badStage.body.error.code, 'VALIDATION_ERROR');

  const badStatus = await request(app)
    .patch(`/projects/${project.id}`)
    .set('X-User-Id', USER)
    .send({ status: 'cancelled' });
  assert.equal(badStatus.status, 400);
});

test('PATCH /projects/:projectId rejects a non-owner, unknown project, empty body, and unknown keys', async () => {
  const { app } = testApp();
  const labId = await createLab(app);
  const project = await createProject(app, labId);

  const notOwner = await request(app)
    .patch(`/projects/${project.id}`)
    .set('X-User-Id', OTHER)
    .send({ title: 'X' });
  assert.equal(notOwner.status, 403);

  const missing = await request(app)
    .patch('/projects/does-not-exist')
    .set('X-User-Id', USER)
    .send({ title: 'X' });
  assert.equal(missing.status, 404);

  const empty = await request(app)
    .patch(`/projects/${project.id}`)
    .set('X-User-Id', USER)
    .send({});
  assert.equal(empty.status, 400);

  const secretKey = await request(app)
    .patch(`/projects/${project.id}`)
    .set('X-User-Id', USER)
    .send({ title: 'X', api_key: 'sk-secret' });
  assert.equal(secretKey.status, 400);
});
