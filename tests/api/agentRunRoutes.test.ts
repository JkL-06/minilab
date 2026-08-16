import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';
import { testAuthDeps } from '../support/testAuth';

import { createApp } from '../../src/api/app';
import { AgentService } from '../../src/application/agentService';
import { LabService } from '../../src/application/labService';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { ModelGatewayError } from '../../src/domain/errors';
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
  const infra = testModelInfra(labRepo);
  const { runtime, runs, artifacts, artifactService } = testAgentRuntime({
    agentRepo,
    labRepo,
    projectRepo,
    taskRepo,
    modelConfigService: infra.modelConfigService,
    gateway: infra.gateway,
  });
  const memoryService = new MemoryService(inMemoryMemoryRepository(), labRepo, agentRepo, projectRepo, new KeywordMemorySearch());
  const meetingService = testMeetingService({ projectRepo, labRepo, agentRepo, taskRepo, artifacts, taskService, memoryService });
  const dashboardService = testDashboardService({ labRepo, agentRepo, projectRepo, taskRepo, artifacts });
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
    ...testAuthDeps(),
  });
  return { app, taskService, mock: infra.mock, runs, artifacts };
}

async function createWorld(app: ReturnType<typeof testApp>['app']) {
  const labRes = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab' });
  const labId = labRes.body.lab.id as string;

  const aliceRes = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });
  const aliceId = aliceRes.body.agent.id as string;

  const bobRes = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Bob' });
  const bobId = bobRes.body.agent.id as string;

  const projRes = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: 'Survey' });
  const projectId = projRes.body.project.id as string;

  const configRes = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'Mock', provider: 'mock', model: 'mock-a' });
  assert.equal(configRes.status, 201);
  const configId = configRes.body.modelConfig.id as string;

  // Bind Alice to the model config so she can execute runs.
  const bindRes = await request(app)
    .patch(`/agents/${aliceId}`)
    .set('X-User-Id', USER)
    .send({ modelConfigId: configId });
  assert.equal(bindRes.status, 200);

  const taskRes = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'Map evidence', assigneeAgentId: aliceId });
  const taskId = taskRes.body.task.id as string;

  return { labId, aliceId, bobId, projectId, taskId };
}

/** Advances a task to `running` so the default (schema-aware) mock can complete it. */
async function runToCompletion(app: ReturnType<typeof testApp>['app'], taskId: string) {
  for (const status of ['ready', 'running']) {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('X-User-Id', USER)
      .send({ status });
    assert.equal(res.status, 200, `task should advance to ${status}`);
  }
}

test('POST /agents/:agentId/runs executes one task and completes it, returning a traceable run (acceptance #4)', async () => {
  const { app } = testApp();
  const { aliceId, projectId, taskId } = await createWorld(app);
  await runToCompletion(app, taskId);

  const res = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });

  assert.equal(res.status, 201);
  const run = res.body.run;
  assert.equal(run.status, 'succeeded');
  assert.equal(run.agentId, aliceId);
  assert.equal(run.taskId, taskId);
  assert.equal(run.projectId, projectId);
  assert.equal(run.provider, 'mock');
  assert.equal(run.model, 'mock-a');
  assert.equal(run.result.task_status, 'completed');
  assert.equal(run.result.summary, 'Mock completion for: Complete the assigned task and return the structured result.');
  assert.equal(run.errorCategory, null);

  // The validated status was applied through the TaskService state machine.
  const taskRes = await request(app).get(`/tasks/${taskId}`).set('X-User-Id', USER);
  assert.equal(taskRes.body.task.status, 'completed');
});

test('a raw (unvalidated) model reply cannot mutate the task — retryable schema run (acceptance #1, #2)', async () => {
  const { app, mock } = testApp();
  const { aliceId, taskId } = await createWorld(app);
  await runToCompletion(app, taskId);

  mock.onCall(() => ({
    content: 'I will take care of it.',
    provider: 'mock',
    model: 'mock-a',
    finishReason: 'stop',
    usage: null,
  }));

  const res = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });

  assert.equal(res.status, 201, 'the run is the created resource even on failure');
  assert.equal(res.body.run.status, 'retryable');
  assert.equal(res.body.run.errorCategory, 'schema');
  assert.equal(res.body.run.result, null);

  const taskRes = await request(app).get(`/tasks/${taskId}`).set('X-User-Id', USER);
  assert.equal(taskRes.body.task.status, 'running', 'task state is untouched');
});

test('a provider failure is a retryable run and does not corrupt the task (acceptance #3)', async () => {
  const { app, mock } = testApp();
  const { aliceId, taskId } = await createWorld(app);
  await runToCompletion(app, taskId);

  mock.onCall(() => {
    throw new ModelGatewayError('provider_unavailable', 'provider is down');
  });

  const res = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });

  assert.equal(res.status, 201);
  assert.equal(res.body.run.status, 'retryable');
  assert.equal(res.body.run.errorCategory, 'provider');

  const taskRes = await request(app).get(`/tasks/${taskId}`).set('X-User-Id', USER);
  assert.equal(taskRes.body.task.status, 'running', 'task not corrupted');
});

test('an illegal proposed transition fails the run without changing the task', async () => {
  const { app } = testApp();
  const { aliceId, taskId } = await createWorld(app);
  // Task stays in `backlog`; the mock proposes `completed` — an illegal jump.

  const res = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });

  assert.equal(res.status, 201);
  assert.equal(res.body.run.status, 'failed');
  assert.equal(res.body.run.errorCategory, 'transition');

  const taskRes = await request(app).get(`/tasks/${taskId}`).set('X-User-Id', USER);
  assert.equal(taskRes.body.task.status, 'backlog', 'task unchanged');
});

test('trigger errors: unknown agent, task not assigned, cross-lab, and no auth', async () => {
  const { app } = testApp();
  const { aliceId, bobId, taskId } = await createWorld(app);

  // Unknown agent.
  const noAgent = await request(app)
    .post('/agents/no-such-agent/runs')
    .set('X-User-Id', USER)
    .send({ taskId });
  assert.equal(noAgent.status, 404);

  // Unknown task.
  const noTask = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId: 'no-such-task' });
  assert.equal(noTask.status, 404);

  // A task assigned to Bob cannot be run by Alice's agent.
  const notAssigned = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });
  const bobTask = await request(app)
    .patch(`/tasks/${taskId}`)
    .set('X-User-Id', USER)
    .send({ assigneeAgentId: bobId });
  assert.equal(bobTask.status, 200);
  const reRun = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });
  assert.equal(reRun.status, 403);
  assert.equal(reRun.body.error.code, 'FORBIDDEN');
  void notAssigned;

  // Non-owner cannot trigger a run in someone else's lab.
  const crossLab = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', OTHER)
    .send({ taskId });
  assert.equal(crossLab.status, 403);

  // No auth header.
  const noAuth = await request(app).post(`/agents/${aliceId}/runs`).send({ taskId });
  assert.equal(noAuth.status, 401);
});

test('request body is validated strictly (bad taskId, unknown keys, bad maxTokens)', async () => {
  const { app } = testApp();
  const { aliceId } = await createWorld(app);

  const missing = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'VALIDATION_ERROR');

  const secret = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId: 't', api_key: 'sk-topsecret' });
  assert.equal(secret.status, 400);

  const badTokens = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId: 't', maxTokens: -5 });
  assert.equal(badTokens.status, 400);
});

test('GET /agents/:agentId/runs lists the run log; GET /runs/:runId returns one run', async () => {
  const { app, runs } = testApp();
  const { aliceId, taskId } = await createWorld(app);
  await runToCompletion(app, taskId);

  const first = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });
  assert.equal(first.status, 201);
  const second = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId, instruction: 'Re-run to confirm.' });
  assert.equal(second.status, 201);

  const list = await request(app).get(`/agents/${aliceId}/runs`).set('X-User-Id', USER);
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.runs.map((r: { id: string }) => r.id),
    [second.body.run.id, first.body.run.id],
    'newest first',
  );

  const getRes = await request(app)
    .get(`/runs/${first.body.run.id}`)
    .set('X-User-Id', USER);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.run.id, first.body.run.id);
  assert.equal(getRes.body.run.result.summary, 'Mock completion for: Complete the assigned task and return the structured result.');

  // Cross-lab read is rejected.
  const crossLab = await request(app)
    .get(`/runs/${first.body.run.id}`)
    .set('X-User-Id', OTHER);
  assert.equal(crossLab.status, 403);

  // Unknown run id.
  const missing = await request(app).get('/runs/no-such-run').set('X-User-Id', USER);
  assert.equal(missing.status, 404);

  assert.equal((runs as unknown as { runs: unknown[] })['runs'].length, 2);
});

test('a completed run persists suggested tasks as proposals, artifacts as rows (acceptance #5)', async () => {
  const { app, runs, artifacts } = testApp();
  const { aliceId, taskId, projectId } = await createWorld(app);
  await runToCompletion(app, taskId);

  const res = await request(app)
    .post(`/agents/${aliceId}/runs`)
    .set('X-User-Id', USER)
    .send({ taskId });

  assert.equal(res.status, 201);
  assert.equal(res.body.run.result.suggested_tasks.length, 1);
  assert.equal(res.body.run.result.memory_candidates.length, 1);
  assert.equal(res.body.run.result.artifact_proposals.length, 1);

  // No follow-up Task rows were created by the run (SPEC-006: suggested tasks
  // stay proposals).
  const listTasks = await request(app)
    .get(`/projects/${res.body.run.projectId}/tasks`)
    .set('X-User-Id', USER);
  assert.equal(listTasks.body.tasks.length, 1);
  assert.equal((runs as unknown as { runs: unknown[] })['runs'].length, 1);

  // SPEC-008: artifact proposals are materialized into durable Artifact rows,
  // and the persisted run result carries the created id.
  assert.equal(artifacts.artifacts.length, 1, 'one Artifact row was created by the run');
  const materialized = artifacts.artifacts[0];
  assert.equal(materialized.projectId, projectId, 'artifact is linked to its Project');
  assert.equal(res.body.run.result.artifact_proposals[0].id, materialized.id, 'run result carries the created artifact id');
});
