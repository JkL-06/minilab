import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

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
  const modelGateway = new ModelGatewayService({
    openai_compatible: new OpenAICompatibleAdapter(),
    mock: new MockProviderAdapter(),
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
  return createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway, agentRuntime, memoryService, artifactService, meetingService, dashboardService });
}

const USER = 'user-1';

/**
 * SPEC-009 acceptance criteria end-to-end, across a restart:
 *  1. A Meeting can include Alice, Bob, and one Project.
 *  2. Participant updates are grounded in their current tasks/artifacts.
 *  3. The PI can record a Decision.
 *  4. Action items generate follow-up Tasks.
 *  5. Meeting completion writes Project/Lab memory with provenance.
 *  6. Completion is a structured record, not just a transcript.
 * Plus the cross-cutting rule: everything survives a restart.
 */
test('acceptance: a group meeting produces decisions, tasks, and memory that survive restart', async () => {
  const dbPath = tempDbPath();
  try {
    let labId: string;
    let projectId: string;
    let meetingId: string;
    let followUpTaskId: string;

    // --- First application instance ---
    {
      const db1 = openDatabase(dbPath);
      const app1 = appWith(db1, dbPath);

      const labRes = await request(app1).post('/labs').set('X-User-Id', USER).send({ name: 'Lab' });
      assert.equal(labRes.status, 201);
      labId = labRes.body.lab.id as string;

      const aliceRes = await request(app1)
        .post(`/labs/${labId}/agents`)
        .set('X-User-Id', USER)
        .send({ name: 'Alice' });
      assert.equal(aliceRes.status, 201);
      const aliceId = aliceRes.body.agent.id as string;

      const bobRes = await request(app1)
        .post(`/labs/${labId}/agents`)
        .set('X-User-Id', USER)
        .send({ name: 'Bob' });
      assert.equal(bobRes.status, 201);
      const bobId = bobRes.body.agent.id as string;

      const projRes = await request(app1)
        .post(`/labs/${labId}/projects`)
        .set('X-User-Id', USER)
        .send({ title: 'Evidence survey' });
      assert.equal(projRes.status, 201);
      projectId = projRes.body.project.id as string;

      // Alice owns work in the project → her update will be grounded in it (#2).
      const taskRes = await request(app1)
        .post(`/projects/${projectId}/tasks`)
        .set('X-User-Id', USER)
        .send({ title: 'Map the evidence base.', assigneeAgentId: aliceId });
      assert.equal(taskRes.status, 201);

      // #1: the Meeting includes Alice, Bob, and one Project.
      const meetRes = await request(app1)
        .post(`/projects/${projectId}/meetings`)
        .set('X-User-Id', USER)
        .send({ title: 'Sprint sync', agenda: 'Turn the survey into decisions.', participantAgentIds: [aliceId, bobId] });
      assert.equal(meetRes.status, 201);
      meetingId = meetRes.body.meeting.id as string;
      assert.equal(meetRes.body.meeting.projectId, projectId, '#1: exactly one Project');

      const detail = await request(app1).get(`/meetings/${meetingId}`).set('X-User-Id', USER);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.participants.length, 2, '#1: Alice and Bob attend');
      const aliceUpdate = detail.body.updates.find((u: { agentId: string }) => u.agentId === aliceId);
      assert.match(aliceUpdate.content, /Map the evidence base\./, '#2: grounded in Alice’s task');

      // #3: the PI records a Decision.
      const decRes = await request(app1)
        .post(`/meetings/${meetingId}/decisions`)
        .set('X-User-Id', USER)
        .send({ statement: 'Adopt a survey-first stage plan.', rationale: 'Evidence is thin.' });
      assert.equal(decRes.status, 201);
      assert.equal(decRes.body.decision.madeById, USER);

      // #4: an action item generates a follow-up Task.
      const itemRes = await request(app1)
        .post(`/meetings/${meetingId}/action-items`)
        .set('X-User-Id', USER)
        .send({ title: 'Draft the survey protocol', assigneeAgentId: aliceId });
      assert.equal(itemRes.status, 201);
      const itemId = itemRes.body.actionItem.id as string;

      const genRes = await request(app1)
        .post(`/meetings/${meetingId}/action-items/${itemId}/tasks`)
        .set('X-User-Id', USER);
      assert.equal(genRes.status, 201);
      followUpTaskId = genRes.body.task.id as string;
      assert.equal(genRes.body.task.projectId, projectId, '#4: the follow-up task lands in the Meeting’s Project');

      // #5/#6: completing writes memory and is a structured record.
      const completeRes = await request(app1)
        .post(`/meetings/${meetingId}/complete`)
        .set('X-User-Id', USER);
      assert.equal(completeRes.status, 200);
      assert.equal(completeRes.body.meeting.status, 'completed');
      assert.equal(completeRes.body.memoryWriteIds.length, 2, '#5: project + lab memory written');
      assert.equal(completeRes.body.decisions.length, 1);
      assert.deepEqual(completeRes.body.resultingTaskIds, [followUpTaskId]);
      assert.ok(completeRes.body.updates.length >= 2, '#6: updates/decisions/tasks, not just a transcript');

      db1.close();
    }

    // --- Second application instance on the same database file ("restart") ---
    {
      const db2 = openDatabase(dbPath);
      const app2 = appWith(db2, dbPath);

      // The Meeting and its structured outcome survive the restart.
      const getRes = await request(app2).get(`/meetings/${meetingId}`).set('X-User-Id', USER);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.meeting.status, 'completed');
      assert.equal(getRes.body.participants.length, 2);
      assert.equal(getRes.body.decisions.length, 1);
      assert.equal(getRes.body.decisions[0].statement, 'Adopt a survey-first stage plan.');
      assert.deepEqual(getRes.body.resultingTaskIds, [followUpTaskId], 'the follow-up task link survives');
      assert.equal(getRes.body.memoryWriteIds.length, 2);

      // The follow-up Task itself is durable.
      const taskGet = await request(app2).get(`/tasks/${followUpTaskId}`).set('X-User-Id', USER);
      assert.equal(taskGet.status, 200);
      assert.equal(taskGet.body.task.title, 'Draft the survey protocol');
      assert.equal(taskGet.body.task.status, 'backlog', 'the generated task starts in the backlog');

      // The outcome memory rows are durable and provenance-complete.
      const memRes = await request(app2).get(`/labs/${labId}/memory`).set('X-User-Id', USER);
      assert.equal(memRes.status, 200);
      const meetingRows = memRes.body.memories.filter((m: { sourceType: string }) => m.sourceType === 'meeting');
      assert.equal(meetingRows.length, 2);
      assert.ok(meetingRows.every((m: { sourceId: string }) => m.sourceId === meetingId));
      assert.ok(
        meetingRows.some((m: { scope: string; scopeId: string }) => m.scope === 'project' && m.scopeId === projectId),
      );

      // The Meeting is visible from its Project after restart.
      const listRes = await request(app2)
        .get(`/projects/${projectId}/meetings`)
        .set('X-User-Id', USER);
      assert.equal(listRes.status, 200);
      assert.deepEqual(listRes.body.meetings.map((m: { id: string }) => m.id), [meetingId]);

      db2.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});
