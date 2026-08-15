import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp } from '../../src/api/app';
import { AgentRuntimeService } from '../../src/application/agentRuntimeService';
import { AgentService } from '../../src/application/agentService';
import { ArtifactService } from '../../src/application/artifactService';
import { DashboardService } from '../../src/application/dashboardService';
import { LabService } from '../../src/application/labService';
import { MemoryService } from '../../src/application/memoryService';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { ModelConfigService } from '../../src/application/modelConfigService';
import { ModelGatewayService } from '../../src/application/modelGateway';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { openDatabase, type MiniLabDb } from '../../src/infrastructure/db/database';
import { SqliteAgentRepository } from '../../src/infrastructure/db/sqliteAgentRepository';
import { SqliteAgentRunRepository } from '../../src/infrastructure/db/sqliteAgentRunRepository';
import { SqliteArtifactRepository } from '../../src/infrastructure/db/sqliteArtifactRepository';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteMemoryRepository } from '../../src/infrastructure/db/sqliteMemoryRepository';
import { SqliteModelConfigRepository } from '../../src/infrastructure/db/sqliteModelConfigRepository';
import { SqliteProjectRepository } from '../../src/infrastructure/db/sqliteProjectRepository';
import { SqliteTaskRepository } from '../../src/infrastructure/db/sqliteTaskRepository';
import { OpenAICompatibleAdapter } from '../../src/infrastructure/models/adapters/openAiCompatibleAdapter';
import { MockProviderAdapter } from '../../src/infrastructure/models/adapters/mockProviderAdapter';
import { getOrCreateCredentialCipher } from '../../src/infrastructure/models/credentialCipher';
import { MeetingService } from '../../src/application/meetingService';
import { SqliteMeetingRepository } from '../../src/infrastructure/db/sqliteMeetingRepository';
import { SqliteDecisionRepository } from '../../src/infrastructure/db/sqliteDecisionRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

/** appWith variant that also returns the mock adapter so the test can capture prompts. */
function appWith(db: MiniLabDb, dbPath: string) {
  const labRepository = new SqliteLabRepository(db);
  const agentRepository = new SqliteAgentRepository(db);
  const projectRepository = new SqliteProjectRepository(db);
  const taskRepository = new SqliteTaskRepository(db);
  const labService = new LabService(labRepository);
  const agentService = new AgentService(agentRepository, labRepository);
  const projectService = new ProjectService(projectRepository, labRepository);
  const taskService = new TaskService(taskRepository, projectRepository, agentRepository, labRepository);
  const modelConfigService = new ModelConfigService(
    new SqliteModelConfigRepository(db),
    labRepository,
    getOrCreateCredentialCipher(undefined, `${dbPath}.key`),
  );
  const mock = new MockProviderAdapter();
  const modelGateway = new ModelGatewayService({
    openai_compatible: new OpenAICompatibleAdapter(),
    mock,
  });
  const memoryService = new MemoryService(
    new SqliteMemoryRepository(db),
    labRepository,
    agentRepository,
    projectRepository,
    new KeywordMemorySearch(),
  );
  const artifactService = new ArtifactService(
    new SqliteArtifactRepository(db),
    projectRepository,
    labRepository,
  );
  const agentRuntime = new AgentRuntimeService(
    agentRepository,
    labRepository,
    projectRepository,
    taskRepository,
    taskService,
    modelConfigService,
    modelGateway,
    new SqliteAgentRunRepository(db),
    memoryService,
    artifactService,
  );
  const meetingService = new MeetingService(
    new SqliteMeetingRepository(db),
    new SqliteDecisionRepository(db),
    projectRepository,
    labRepository,
    agentRepository,
    taskRepository,
    new SqliteArtifactRepository(db),
    taskService,
    memoryService,
  );
  const dashboardService = new DashboardService(
    labRepository,
    agentRepository,
    projectRepository,
    taskRepository,
    new SqliteArtifactRepository(db),
    new SqliteMeetingRepository(db),
    new SqliteDecisionRepository(db),
    new SqliteAgentRunRepository(db),
  );
  const app = createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway, agentRuntime, memoryService, artifactService, meetingService, dashboardService });
  return { app, mock };
}

const USER = 'user-1';

/** Creates lab, Alice + Bob agents, a project, and a bound mock config. */
async function seedWorld(app: ReturnType<typeof appWith>['app']) {
  const labRes = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Lab' });
  assert.equal(labRes.status, 201);
  const labId = labRes.body.lab.id as string;

  const aliceRes = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Alice' });
  assert.equal(aliceRes.status, 201);
  const aliceId = aliceRes.body.agent.id as string;

  const bobRes = await request(app)
    .post(`/labs/${labId}/agents`)
    .set('X-User-Id', USER)
    .send({ name: 'Bob' });
  assert.equal(bobRes.status, 201);
  const bobId = bobRes.body.agent.id as string;

  const projRes = await request(app)
    .post(`/labs/${labId}/projects`)
    .set('X-User-Id', USER)
    .send({ title: 'Evidence survey' });
  assert.equal(projRes.status, 201);
  const projectId = projRes.body.project.id as string;

  const configRes = await request(app)
    .post(`/labs/${labId}/model-configs`)
    .set('X-User-Id', USER)
    .send({ name: 'Mock', provider: 'mock', model: 'mock-a' });
  assert.equal(configRes.status, 201);
  const configId = configRes.body.modelConfig.id as string;

  const bindRes = await request(app)
    .patch(`/agents/${aliceId}`)
    .set('X-User-Id', USER)
    .send({ modelConfigId: configId });
  assert.equal(bindRes.status, 200);

  return { labId, aliceId, bobId, projectId, configId };
}

async function addRunningTask(app: ReturnType<typeof appWith>['app'], projectId: string, aliceId: string, title: string) {
  const taskRes = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title, assigneeAgentId: aliceId });
  assert.equal(taskRes.status, 201);
  const taskId = taskRes.body.task.id as string;
  for (const status of ['ready', 'running']) {
    const move = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('X-User-Id', USER)
      .send({ status });
    assert.equal(move.status, 200);
  }
  return taskId;
}

/**
 * SPEC-007 acceptance criteria exercised end-to-end:
 *  1. Alice retrieves her own Agent Memory — visible in her system prompt.
 *  2. Bob cannot read Alice-private Memory — Bob's agent memory is absent from Alice's prompt.
 *  3. Project Memory retrievable in later project tasks — present across two tasks and a restart.
 *  4. Memory survives a restart.
 *  5. Provenance (source type + source id + author) is exposed in the prompt.
 */
test('acceptance: memory written via the API reaches the Agent prompt and survives restart', async () => {
  const dbPath = tempDbPath();
  try {
    let labId: string;
    let aliceId: string;
    let projectId: string;

    // --- First application instance ---
    {
      const db1 = openDatabase(dbPath);
      const { app, mock } = appWith(db1, dbPath);

      const world = await seedWorld(app);
      labId = world.labId;
      aliceId = world.aliceId;
      projectId = world.projectId;
      const bobId = world.bobId;

      // PI writes memory in several scopes (acceptance #1/#3/#5).
      const aliceMemRes = await request(app)
        .post(`/labs/${labId}/memory`)
        .set('X-User-Id', USER)
        .send({ scope: 'agent', scopeId: aliceId, content: 'Alice prefers structured survey notes.', sourceType: 'interview', sourceId: 'interview-2026-08' });
      assert.equal(aliceMemRes.status, 201);
      assert.equal(aliceMemRes.body.memory.sourceType, 'interview', 'provenance exposed (acceptance #5)');
      assert.equal(aliceMemRes.body.memory.sourceId, 'interview-2026-08');

      await request(app)
        .post(`/labs/${labId}/memory`)
        .set('X-User-Id', USER)
        .send({ scope: 'project', scopeId: projectId, content: 'This survey targets working memory.', sourceType: 'note', sourceId: 's3' });

      await request(app)
        .post(`/labs/${labId}/memory`)
        .set('X-User-Id', USER)
        .send({ scope: 'lab', content: 'Lab policy: always cite sources.', sourceType: 'note', sourceId: 's4' });

      // Bob's private memory must never leak into Alice's prompt (acceptance #2).
      await request(app)
        .post(`/labs/${labId}/memory`)
        .set('X-User-Id', USER)
        .send({ scope: 'agent', scopeId: bobId, content: 'Bob: private statistics preference.', sourceType: 'note', sourceId: 's5' });

      // Run Alice's task and capture the system prompt.
      const taskId = await addRunningTask(app, projectId, aliceId, 'Map the evidence base.');
      let capturedSystem = '';
      mock.onCall(async (request, options) => {
        capturedSystem = request.messages[0].content;
        return {
          content: JSON.stringify({
            summary: 'Mapped.',
            task_status: 'completed',
            artifact_proposals: [{ title: 'Artifact' }],
            findings: [{ claim: 'Finding' }],
            questions_for_pi: [{ question: 'Question?' }],
            suggested_tasks: [{ title: 'Follow-up', rationale: 'Auto' }],
            memory_candidates: [{ content: 'Candidate', scope: 'project' }],
          }),
          provider: 'mock',
          model: options.model,
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      });

      const runRes = await request(app)
        .post(`/agents/${aliceId}/runs`)
        .set('X-User-Id', USER)
        .send({ taskId, instruction: 'Map the evidence base.' });
      assert.equal(runRes.status, 201);
      assert.equal(runRes.body.run.status, 'succeeded');

      assert.match(capturedSystem, /Authorized memory:/);
      assert.match(capturedSystem, /Alice prefers structured survey notes\./, 'acceptance #1: her own agent memory');
      assert.match(capturedSystem, /This survey targets working memory\./, 'acceptance #3: current project memory');
      assert.match(capturedSystem, /Lab policy: always cite sources\./, 'lab-shared memory is authorized');
      assert.doesNotMatch(capturedSystem, /Bob: private statistics preference\./, 'acceptance #2: Bob’s private memory is excluded');
      assert.match(capturedSystem, /by pi:user-1, /, 'provenance is rendered for the model (rule 17)');
      assert.match(capturedSystem, /\[agent\]|\[project\]|\[lab\]/, 'scope is rendered on each memory line');

      db1.close();
    }

    // --- Second application instance on the same database file ("restart") ---
    {
      const db2 = openDatabase(dbPath);
      const { app, mock } = appWith(db2, dbPath);

      // Acceptance #4: the memory rows survive the restart.
      const listRes = await request(app)
        .get(`/labs/${labId}/memory`)
        .set('X-User-Id', USER);
      assert.equal(listRes.status, 200);
      assert.equal(listRes.body.memories.length, 4, 'all four memories persist');

      const searchRes = await request(app)
        .get(`/labs/${labId}/memory/search?q=working+memory`)
        .set('X-User-Id', USER);
      assert.equal(searchRes.status, 200);
      assert.equal(searchRes.body.fallback, false);
      assert.ok(searchRes.body.memories.some((m: { content: string }) => m.content.includes('working memory')));

      // Acceptance #3 across restart: a later task in the same project still
      // receives the project memory in its prompt.
      const taskId2 = await addRunningTask(app, projectId, aliceId, 'Synthesize the write-up.');
      let capturedSystem2 = '';
      mock.onCall(async (request, options) => {
        capturedSystem2 = request.messages[0].content;
        return {
          content: JSON.stringify({
            summary: 'Synthesized.',
            task_status: 'completed',
            artifact_proposals: [],
            findings: [],
            questions_for_pi: [],
            suggested_tasks: [],
            memory_candidates: [],
          }),
          provider: 'mock',
          model: options.model,
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      });

      const runRes2 = await request(app)
        .post(`/agents/${aliceId}/runs`)
        .set('X-User-Id', USER)
        .send({ taskId: taskId2, instruction: 'Synthesize.' });
      assert.equal(runRes2.status, 201);
      assert.equal(runRes2.body.run.status, 'succeeded');
      assert.match(capturedSystem2, /This survey targets working memory\./, 'acceptance #3: project memory in a later task, after restart');

      db2.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});
