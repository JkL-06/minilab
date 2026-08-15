import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

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
  const app = createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway: gateway, agentRuntime: runtime, memoryService, artifactService, meetingService, dashboardService });
  return { app, taskService };
}

async function createWorld(app: ReturnType<typeof testApp>['app']) {
  const labRes = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab' });
  assert.equal(labRes.status, 201);
  const labId = labRes.body.lab.id as string;

  const aliceRes = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });
  assert.equal(aliceRes.status, 201);
  const aliceId = aliceRes.body.agent.id as string;

  const projRes = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: 'Survey' });
  assert.equal(projRes.status, 201);
  const projectId = projRes.body.project.id as string;

  return { labId, aliceId, projectId };
}

test('POST /projects/:projectId/tasks assigns a task to Alice (SPEC-004 #1)', async () => {
  const { app } = testApp();
  const { aliceId, projectId } = await createWorld(app);

  const res = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'Map the evidence base.', assigneeAgentId: aliceId, priority: 'high' });

  assert.equal(res.status, 201);
  assert.ok(res.body.task.id, 'persistent task id returned');
  assert.equal(res.body.task.projectId, projectId, 'task belongs to exactly one project');
  assert.equal(res.body.task.assigneeAgentId, aliceId, 'assigned to Alice');
  assert.equal(res.body.task.creatorType, 'pi');
  assert.equal(res.body.task.creatorId, USER, 'creator provenance is server-set');
  assert.equal(res.body.task.status, 'backlog');
  assert.equal(res.body.task.priority, 'high');
  assert.equal(res.body.task.dueAt, null);
});

test('POST /projects/:projectId/tasks rejects an assignee from a different lab (SPEC-004 #3)', async () => {
  const { app } = testApp();
  const { projectId } = await createWorld(app);

  const otherLab = await request(app)
    .post('/labs')
    .set('X-User-Id', OTHER)
    .send({ name: 'Other Lab' });
  const mallory = await request(app)
    .post(`/labs/${otherLab.body.lab.id}/agents`)
    .set('X-User-Id', OTHER)
    .send({ name: 'Mallory' });

  const res = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: mallory.body.agent.id });

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('POST /projects/:projectId/tasks rejects an unknown assignee and an unknown project', async () => {
  const { app } = testApp();
  const { aliceId, projectId } = await createWorld(app);

  const noAgent = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: 'no-such-agent' });
  assert.equal(noAgent.status, 404);
  assert.equal(noAgent.body.error.code, 'NOT_FOUND');

  const noProject = await request(app)
    .post('/projects/no-such-project/tasks')
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: aliceId });
  assert.equal(noProject.status, 404);
});

test('POST /projects/:projectId/tasks rejects a non-owner and no auth', async () => {
  const { app } = testApp();
  const { aliceId, projectId } = await createWorld(app);

  const notOwner = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', OTHER)
    .send({ title: 'X', assigneeAgentId: aliceId });
  assert.equal(notOwner.status, 403);

  const noAuth = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .send({ title: 'X', assigneeAgentId: aliceId });
  assert.equal(noAuth.status, 401);
});

test('POST /projects/:projectId/tasks rejects bad bodies and forged provenance', async () => {
  const { app, taskService } = testApp();
  const { aliceId, projectId } = await createWorld(app);

  const emptyTitle = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: '', assigneeAgentId: aliceId });
  assert.equal(emptyTitle.status, 400);

  const badPriority = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: aliceId, priority: 'critical' });
  assert.equal(badPriority.status, 400);

  const badDueAt = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: aliceId, dueAt: 'tomorrow' });
  assert.equal(badDueAt.status, 400);

  const noAssignee = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X' });
  assert.equal(noAssignee.status, 400);

  // Unknown keys (incl. secret-looking ones) and forged creator fields are rejected.
  const secret = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: aliceId, api_key: 'sk-topsecret' });
  assert.equal(secret.status, 400);

  const forgeCreator = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: aliceId, creatorType: 'agent', creatorId: aliceId });
  assert.equal(forgeCreator.status, 400, 'creator provenance cannot be forged');
  assert.equal(taskService.listTasks(USER, projectId).length, 0, 'nothing was created');
});

test('GET /projects/:projectId/tasks lists the project’s tasks; GET /tasks/:taskId returns one', async () => {
  const { app } = testApp();
  const { aliceId, projectId } = await createWorld(app);
  const created = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'Map the evidence base.', assigneeAgentId: aliceId });

  const listRes = await request(app)
    .get(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER);
  assert.equal(listRes.status, 200);
  assert.deepEqual(
    listRes.body.tasks.map((t: { id: string }) => t.id),
    [created.body.task.id],
  );

  const getRes = await request(app)
    .get(`/tasks/${created.body.task.id}`)
    .set('X-User-Id', USER);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.task.assigneeAgentId, aliceId);
  assert.equal(getRes.body.task.title, 'Map the evidence base.');
});

test('GET /tasks/:taskId rejects cross-lab access and returns 404 for an unknown task', async () => {
  const { app } = testApp();
  const { aliceId, projectId } = await createWorld(app);
  const created = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: aliceId });

  const crossLab = await request(app)
    .get(`/tasks/${created.body.task.id}`)
    .set('X-User-Id', OTHER);
  assert.equal(crossLab.status, 403);
  assert.equal(crossLab.body.error.code, 'FORBIDDEN');

  const missing = await request(app).get('/tasks/does-not-exist').set('X-User-Id', USER);
  assert.equal(missing.status, 404);
});

test('PATCH /tasks/:taskId rejects invalid status transitions (SPEC-004 #4)', async () => {
  const { app } = testApp();
  const { aliceId, projectId } = await createWorld(app);
  const created = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: aliceId });

  // Legal: backlog → ready → running → review → completed.
  for (const status of ['ready', 'running', 'review', 'completed']) {
    const res = await request(app)
      .patch(`/tasks/${created.body.task.id}`)
      .set('X-User-Id', USER)
      .send({ status });
    assert.equal(res.status, 200, `transition to ${status} should be accepted`);
    assert.equal(res.body.task.status, status);
  }

  // Illegal: completed is terminal.
  const invalid = await request(app)
    .patch(`/tasks/${created.body.task.id}`)
    .set('X-User-Id', USER)
    .send({ status: 'running' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /tasks/:taskId completing keeps prior history (SPEC-004 #5)', async () => {
  const { app } = testApp();
  const { aliceId, projectId } = await createWorld(app);
  const created = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'Keep history', description: 'initial notes', assigneeAgentId: aliceId });

  // Walk a valid chain to completion.
  let completed;
  for (const status of ['ready', 'running', 'review', 'completed']) {
    completed = await request(app)
      .patch(`/tasks/${created.body.task.id}`)
      .set('X-User-Id', USER)
      .send({ status });
  }
  assert.equal(completed!.status, 200);
  assert.equal(completed!.body.task.status, 'completed');

  const after = await request(app)
    .get(`/tasks/${created.body.task.id}`)
    .set('X-User-Id', USER);
  assert.equal(after.status, 200, 'still retrievable after completion');
  assert.equal(after.body.task.title, 'Keep history');
  assert.equal(after.body.task.assigneeAgentId, aliceId, 'assignment retained');
  assert.equal(after.body.task.description, 'initial notes');
});

test('PATCH /tasks/:taskId updates fields, rejects cross-lab reassignment, empty body, and unknown keys', async () => {
  const { app } = testApp();
  const { aliceId, projectId, labId } = await createWorld(app);

  // A second same-lab agent for reassignment.
  const bob = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Bob' });

  const created = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'X', assigneeAgentId: aliceId });

  const updated = await request(app)
    .patch(`/tasks/${created.body.task.id}`)
    .set('X-User-Id', USER)
    .send({ assigneeAgentId: bob.body.agent.id, priority: 'urgent', dueAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.task.assigneeAgentId, bob.body.agent.id);
  assert.equal(updated.body.task.priority, 'urgent');
  assert.equal(updated.body.task.dueAt, '2026-09-01T00:00:00.000Z');

  // Cross-lab reassignment is rejected.
  const otherLab = await request(app)
    .post('/labs')
    .set('X-User-Id', OTHER)
    .send({ name: 'Other Lab' });
  const mallory = await request(app)
    .post(`/labs/${otherLab.body.lab.id}/agents`)
    .set('X-User-Id', OTHER)
    .send({ name: 'Mallory' });
  const crossReassign = await request(app)
    .patch(`/tasks/${created.body.task.id}`)
    .set('X-User-Id', USER)
    .send({ assigneeAgentId: mallory.body.agent.id });
  assert.equal(crossReassign.status, 403);

  const empty = await request(app)
    .patch(`/tasks/${created.body.task.id}`)
    .set('X-User-Id', USER)
    .send({});
  assert.equal(empty.status, 400);

  const secret = await request(app)
    .patch(`/tasks/${created.body.task.id}`)
    .set('X-User-Id', USER)
    .send({ title: 'X', api_key: 'sk-secret' });
  assert.equal(secret.status, 400);
});
