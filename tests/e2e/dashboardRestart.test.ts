import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';
import { testAuthDeps } from '../support/testAuth';

import { createApp } from '../../src/api/app';
import { AgentRuntimeService } from '../../src/application/agentRuntimeService';
import { AgentService } from '../../src/application/agentService';
import { ArtifactService } from '../../src/application/artifactService';
import { DashboardService } from '../../src/application/dashboardService';
import { LabService } from '../../src/application/labService';
import { MeetingService } from '../../src/application/meetingService';
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
import { SqliteDecisionRepository } from '../../src/infrastructure/db/sqliteDecisionRepository';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteMeetingRepository } from '../../src/infrastructure/db/sqliteMeetingRepository';
import { SqliteMemoryRepository } from '../../src/infrastructure/db/sqliteMemoryRepository';
import { SqliteModelConfigRepository } from '../../src/infrastructure/db/sqliteModelConfigRepository';
import { SqliteProjectRepository } from '../../src/infrastructure/db/sqliteProjectRepository';
import { SqliteTaskRepository } from '../../src/infrastructure/db/sqliteTaskRepository';
import { OpenAICompatibleAdapter } from '../../src/infrastructure/models/adapters/openAiCompatibleAdapter';
import { MockProviderAdapter } from '../../src/infrastructure/models/adapters/mockProviderAdapter';
import { getOrCreateCredentialCipher } from '../../src/infrastructure/models/credentialCipher';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

/** appWith that returns the mock adapter so the test can script a blocked run. */
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
  const app = createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway, agentRuntime, memoryService, artifactService, meetingService, dashboardService, ...testAuthDeps() });
  return { app, mock };
}

const USER = 'user-1';

/**
 * SPEC-010 acceptance criteria end-to-end, across a restart:
 *  1. Opening the app (GET /) lands on the Today / Lab Pulse home page — no
 *     empty-prompt interaction (S1 IA; the per-Lab dashboard remains a deep link).
 *  2. A blocked Task is visible without opening a chat.
 *  3. A pending PI question is visible.
 *  4. Agents render as persistent identity cards.
 *  5. The page is a deterministic read of canonical SQLite state (no model call).
 * Plus: the blocked task, its question, and the materialized Artifact all survive a restart.
 */
test('acceptance: the PI dashboard reflects canonical state and survives restart', async () => {
  const dbPath = tempDbPath();
  try {
    let labId: string;
    let projectId: string;

    // --- First application instance ---
    {
      const db1 = openDatabase(dbPath);
      const { app, mock } = appWith(db1, dbPath);

      const labRes = await request(app).post('/labs').set('X-User-Id', USER).send({ name: 'Cognitive Lab' });
      assert.equal(labRes.status, 201);
      labId = labRes.body.lab.id as string;

      // Acceptance #1: opening the app lands on the Today / Lab Pulse home page
      // (S1 IA — no empty-prompt interaction; the dashboard is one click away).
      const rootRes = await request(app).get('/').set('X-User-Id', USER);
      assert.equal(rootRes.status, 200);
      assert.match(String(rootRes.headers['content-type']), /text\/html/);
      assert.match(rootRes.text, /需要你关注/);

      const aliceRes = await request(app)
        .post(`/labs/${labId}/agents`)
        .set('X-User-Id', USER)
        .send({ name: 'Alice', role: 'phd_researcher', specialization: 'working memory' });
      assert.equal(aliceRes.status, 201);
      const aliceId = aliceRes.body.agent.id as string;

      const projRes = await request(app)
        .post(`/labs/${labId}/projects`)
        .set('X-User-Id', USER)
        .send({ title: 'WM survey', status: 'active', stage: 'survey' });
      assert.equal(projRes.status, 201);
      projectId = projRes.body.project.id as string;

      const cfgRes = await request(app)
        .post(`/labs/${labId}/model-configs`)
        .set('X-User-Id', USER)
        .send({ name: 'mock-a', provider: 'mock', model: 'mock-a' });
      assert.equal(cfgRes.status, 201);
      const configId = cfgRes.body.modelConfig.id as string;
      await request(app).patch(`/agents/${aliceId}`).set('X-User-Id', USER).send({ modelConfigId: configId });

      const taskRes = await request(app)
        .post(`/projects/${projectId}/tasks`)
        .set('X-User-Id', USER)
        .send({ title: 'Map evidence', assigneeAgentId: aliceId });
      assert.equal(taskRes.status, 201);
      const taskId = taskRes.body.task.id as string;
      for (const status of ['ready', 'running']) {
        const move = await request(app).patch(`/tasks/${taskId}`).set('X-User-Id', USER).send({ status });
        assert.equal(move.status, 200);
      }

      // Script the mock: the run succeeds but reports `blocked` + a question + one artifact.
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
        .send({ taskId, instruction: 'Map the evidence', maxTokens: 2048 });
      assert.equal(runRes.status, 201);
      assert.equal(runRes.body.run.status, 'succeeded');

      // Acceptance #2/#3/#4/#5 in the default HTML page.
      const htmlRes = await request(app).get(`/labs/${labId}/dashboard`).set('X-User-Id', USER);
      assert.equal(htmlRes.status, 200);
      assert.match(String(htmlRes.headers['content-type']), /text\/html/);
      assert.match(htmlRes.text, /Map evidence/);
      assert.match(htmlRes.text, /阻塞/); // #2: the blocked task is visible
      assert.match(htmlRes.text, /Should we prioritize individual differences\?/); // #3
      assert.match(htmlRes.text, /data-agent-id="/); // #4: identity cards
      assert.match(htmlRes.text, /持久实验室成员/);
      assert.match(htmlRes.text, /不经过任何模型调用/); // #5

      db1.close();
    }

    // --- Second application instance on the same database file ("restart") ---
    {
      const db2 = openDatabase(dbPath);
      const { app } = appWith(db2, dbPath);

      const htmlRes = await request(app).get(`/labs/${labId}/dashboard`).set('X-User-Id', USER);
      assert.equal(htmlRes.status, 200);
      // The canonical state survived: project, blocked task, question, artifact.
      assert.match(htmlRes.text, /WM survey/);
      assert.match(htmlRes.text, /Map evidence/);
      assert.match(htmlRes.text, /阻塞/);
      assert.match(htmlRes.text, /Should we prioritize individual differences\?/);
      assert.match(htmlRes.text, /Evidence map/);
      assert.match(htmlRes.text, /data-agent-id="/);

      // The JSON feed exposes the same state after restart.
      const jsonRes = await request(app)
        .get(`/labs/${labId}/dashboard`)
        .set('X-User-Id', USER)
        .set('Accept', 'application/json');
      assert.equal(jsonRes.status, 200);
      const d = jsonRes.body.dashboard;
      assert.equal(d.lab.name, 'Cognitive Lab');
      assert.ok(d.attentionTasks.some((t: { title: string; status: string }) => t.title === 'Map evidence' && t.status === 'blocked'));
      assert.deepEqual(d.questionsForPi.map((q: { question: string }) => q.question), ['Should we prioritize individual differences?']);
      assert.ok(d.recentArtifacts.some((a: { title: string }) => a.title === 'Evidence map'));

      db2.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});
