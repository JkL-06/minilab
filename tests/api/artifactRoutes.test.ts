import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';
import { testAuthDeps } from '../support/testAuth';

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
  const { runtime, artifacts, artifactService } = testAgentRuntime({
    agentRepo,
    labRepo,
    projectRepo,
    taskRepo,
    modelConfigService,
    gateway,
  });
  const memoryService = new MemoryService(
    inMemoryMemoryRepository(),
    labRepo,
    agentRepo,
    projectRepo,
    new KeywordMemorySearch(),
  );
  const meetingService = testMeetingService({ projectRepo, labRepo, agentRepo, taskRepo, artifacts, taskService, memoryService });
  const dashboardService = testDashboardService({ labRepo, agentRepo, projectRepo, taskRepo, artifacts });
  const app = createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway: gateway, agentRuntime: runtime, memoryService, artifactService, meetingService, dashboardService, ...testAuthDeps() });
  return { app, artifacts };
}

/** Lab + Alice + Project + bound mock config + a task (returns their ids). */
async function createWorld(app: ReturnType<typeof testApp>['app']) {
  const labRes = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab' });
  const labId = labRes.body.lab.id as string;

  const aliceRes = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });
  const aliceId = aliceRes.body.agent.id as string;

  const projRes = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: 'Survey' });
  const projectId = projRes.body.project.id as string;

  const configRes = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'Mock', provider: 'mock', model: 'mock-a' });
  const configId = configRes.body.modelConfig.id as string;

  await request(app).patch(`/agents/${aliceId}`).set('X-User-Id', USER).send({ modelConfigId: configId });

  const taskRes = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'Map evidence', assigneeAgentId: aliceId });
  const taskId = taskRes.body.task.id as string;

  return { labId, aliceId, projectId, taskId };
}

/** Advances a task to `running` then completes it through the mock gateway. */
async function runToCompletion(app: ReturnType<typeof testApp>['app'], taskId: string) {
  for (const status of ['ready', 'running']) {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('X-User-Id', USER)
      .send({ status });
    assert.equal(res.status, 200);
  }
}

test('a completed Agent run creates an Artifact readable through the API (acceptance #1)', async () => {
  const { app, artifacts } = testApp();
  const { aliceId, taskId } = await createWorld(app);
  await runToCompletion(app, taskId);

  const res = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });
  assert.equal(res.status, 201);
  const artifactId = res.body.run.result.artifact_proposals[0].id as string;
  assert.ok(artifactId, 'the run result carries the created artifact id');

  assert.equal(artifacts.artifacts.length, 1, 'a durable row was created');

  const fetch = await request(app)
    .get(`/artifacts/${artifactId}`)
    .set('X-User-Id', USER);
  assert.equal(fetch.status, 200);
  assert.equal(fetch.body.artifact.id, artifactId);
  assert.equal(fetch.body.artifact.version, 1);
  assert.equal(fetch.body.artifact.type, 'note');
  assert.ok(fetch.body.artifact.content.length > 0, 'content lives in the artifact row (acceptance #5)');
});

test('project artifacts list returns the run materialized rows (acceptance #3)', async () => {
  const { app } = testApp();
  const { aliceId, taskId, projectId } = await createWorld(app);
  await runToCompletion(app, taskId);
  await request(app).post(`/agents/${aliceId}/runs`).set('X-User-Id', USER).send({ taskId });

  const res = await request(app)
    .get(`/projects/${projectId}/artifacts`)
    .set('X-User-Id', USER);
  assert.equal(res.status, 200);
  assert.equal(res.body.artifacts.length, 1);
  assert.equal(res.body.artifacts[0].projectId, projectId, 'linked to its Project');
  assert.ok(res.body.artifacts[0].createdAt, 'timestamp preserved');
});

test('a PI can revise an artifact into the next version (acceptance #4)', async () => {
  const { app } = testApp();
  const { aliceId, taskId } = await createWorld(app);
  await runToCompletion(app, taskId);
  const runRes = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });
  const artifactId = runRes.body.run.result.artifact_proposals[0].id as string;

  const rev = await request(app)
    .post(`/artifacts/${artifactId}/revisions`)
    .set('X-User-Id', USER)
    .send({ content: 'Revised body.', title: 'Evidence map v2', type: 'report' });
  assert.equal(rev.status, 201);
  assert.equal(rev.body.artifact.version, 2);
  assert.equal(rev.body.artifact.title, 'Evidence map v2');
  assert.equal(rev.body.artifact.type, 'report');
  assert.equal(rev.body.artifact.content, 'Revised body.');
  assert.equal(
    rev.body.artifact.metadata.sourceArtifactId,
    artifactId,
    'version lineage is recorded',
  );

  // The original version still exists as a sibling row.
  const fetch = await request(app).get(`/artifacts/${artifactId}`).set('X-User-Id', USER);
  assert.equal(fetch.body.artifact.version, 1);
});

test('artifacts are hidden across Labs and a missing id is a 404', async () => {
  const { app } = testApp();
  const { aliceId, taskId, projectId } = await createWorld(app);
  await runToCompletion(app, taskId);
  const runRes = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });
  const artifactId = runRes.body.run.result.artifact_proposals[0].id as string;

  const forbidden = await request(app)
    .get(`/artifacts/${artifactId}`)
    .set('X-User-Id', OTHER);
  assert.equal(forbidden.status, 403);

  const forbiddenList = await request(app)
    .get(`/projects/${projectId}/artifacts`)
    .set('X-User-Id', OTHER);
  assert.equal(forbiddenList.status, 403);

  const missing = await request(app)
    .get('/artifacts/does-not-exist')
    .set('X-User-Id', USER);
  assert.equal(missing.status, 404);
});

test('revision body is strict and empty content is rejected', async () => {
  const { app } = testApp();
  const { aliceId, taskId } = await createWorld(app);
  await runToCompletion(app, taskId);
  const runRes = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });
  const artifactId = runRes.body.run.result.artifact_proposals[0].id as string;

  const empty = await request(app)
    .post(`/artifacts/${artifactId}/revisions`)
    .set('X-User-Id', USER)
    .send({ content: '   ' });
  assert.equal(empty.status, 400);

  const extra = await request(app)
    .post(`/artifacts/${artifactId}/revisions`)
    .set('X-User-Id', USER)
    .send({ content: 'ok', secret: 'x' });
  assert.equal(extra.status, 400);
});
