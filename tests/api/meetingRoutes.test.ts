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
import { inMemoryDecisionRepository } from '../support/inMemoryDecisionRepository';
import { inMemoryMeetingRepository } from '../support/inMemoryMeetingRepository';

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
  const meetings = inMemoryMeetingRepository();
  const decisions = inMemoryDecisionRepository();
  const meetingService = testMeetingService({ projectRepo, labRepo, agentRepo, taskRepo, artifacts, taskService, memoryService, meetings, decisions });
  const dashboardService = testDashboardService({ labRepo, agentRepo, projectRepo, taskRepo, artifacts, meetings, decisions });
  const app = createApp({ labService, agentService, projectService, taskService, modelConfigService, modelGateway: gateway, agentRuntime: runtime, memoryService, artifactService, meetingService, dashboardService });
  return { app, labService, agentService, projectService };
}

type World = { labId: string; aliceId: string; bobId: string; projectId: string };

/** Lab + Alice + Bob + Project, all through the API. */
async function createWorld(app: ReturnType<typeof testApp>['app']): Promise<World> {
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
    .send({ title: 'Survey' });
  assert.equal(projRes.status, 201);
  const projectId = projRes.body.project.id as string;

  return { labId, aliceId, bobId, projectId };
}

async function createMeeting(app: ReturnType<typeof testApp>['app'], projectId: string, participants: string[]) {
  const res = await request(app)
    .post(`/projects/${projectId}/meetings`)
    .set('X-User-Id', USER)
    .send({ title: 'Sprint sync', agenda: 'Review the plan.', participantAgentIds: participants });
  assert.equal(res.status, 201);
  return res.body.meeting as { id: string; status: string; projectId: string };
}

test('POST /projects/:projectId/meetings prepares a Meeting with grounded participant updates (SPEC-009 #1, #2)', async () => {
  const { app } = testApp();
  const { projectId, aliceId, bobId } = await createWorld(app);

  // Give Alice a task so her update is grounded in it (acceptance #2).
  const taskRes = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set('X-User-Id', USER)
    .send({ title: 'Map evidence', assigneeAgentId: aliceId });
  assert.equal(taskRes.status, 201);
  const taskId = taskRes.body.task.id as string;

  const meeting = await createMeeting(app, projectId, [aliceId, bobId]);
  assert.equal(meeting.status, 'scheduled');
  assert.equal(meeting.projectId, projectId);

  const detail = await request(app).get(`/meetings/${meeting.id}`).set('X-User-Id', USER);
  assert.equal(detail.status, 200);
  assert.deepEqual(
    detail.body.participants.map((p: { agentId: string }) => p.agentId).sort(),
    [aliceId, bobId].sort(),
    'Alice and Bob attend (acceptance #1)',
  );
  const aliceUpdate = detail.body.updates.find((u: { agentId: string }) => u.agentId === aliceId);
  assert.match(aliceUpdate.content, /Map evidence/, 'Alice’s update is grounded in her task');
  assert.deepEqual(aliceUpdate.taskIds, [taskId]);
  const bobUpdate = detail.body.updates.find((u: { agentId: string }) => u.agentId === bobId);
  assert.match(bobUpdate.content, /no tasks in this project/);
});

test('POST meetings rejects an unknown project, a non-owner, and an empty participant list', async () => {
  const { app } = testApp();
  const { projectId, aliceId } = await createWorld(app);

  const unknown = await request(app)
    .post('/projects/no-such-project/meetings')
    .set('X-User-Id', USER)
    .send({ title: 'X', participantAgentIds: [aliceId] });
  assert.equal(unknown.status, 404);

  const notOwner = await request(app)
    .post(`/projects/${projectId}/meetings`)
    .set('X-User-Id', OTHER)
    .send({ title: 'X', participantAgentIds: [aliceId] });
  assert.equal(notOwner.status, 403);

  const noParticipants = await request(app)
    .post(`/projects/${projectId}/meetings`)
    .set('X-User-Id', USER)
    .send({ title: 'X', participantAgentIds: [] });
  assert.equal(noParticipants.status, 400);

  const blankTitle = await request(app)
    .post(`/projects/${projectId}/meetings`)
    .set('X-User-Id', USER)
    .send({ title: '  ', participantAgentIds: [aliceId] });
  assert.equal(blankTitle.status, 400);

  const noAuth = await request(app)
    .post(`/projects/${projectId}/meetings`)
    .send({ title: 'X', participantAgentIds: [aliceId] });
  assert.equal(noAuth.status, 401);
});

test('GET /projects/:projectId/meetings lists the Project’s meetings newest-first', async () => {
  const { app } = testApp();
  const { projectId, aliceId } = await createWorld(app);
  const m1 = await createMeeting(app, projectId, [aliceId]);
  const m2 = await createMeeting(app, projectId, [aliceId]);

  const res = await request(app).get(`/projects/${projectId}/meetings`).set('X-User-Id', USER);
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.meetings.map((m: { id: string }) => m.id),
    [m2.id, m1.id],
    'newest first',
  );

  const forbidden = await request(app).get(`/projects/${projectId}/meetings`).set('X-User-Id', OTHER);
  assert.equal(forbidden.status, 403);
});

test('PATCH /meetings/:meetingId edits agenda and transcript; rejects edits after completion', async () => {
  const { app } = testApp();
  const { projectId, aliceId } = await createWorld(app);
  const meeting = await createMeeting(app, projectId, [aliceId]);

  const patch = await request(app)
    .patch(`/meetings/${meeting.id}`)
    .set('X-User-Id', USER)
    .send({ agenda: 'New agenda', transcript: 'Discussion record.' });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.meeting.agenda, 'New agenda');
  assert.equal(patch.body.meeting.transcript, 'Discussion record.');

  await request(app).post(`/meetings/${meeting.id}/complete`).set('X-User-Id', USER);
  const afterComplete = await request(app)
    .patch(`/meetings/${meeting.id}`)
    .set('X-User-Id', USER)
    .send({ agenda: 'Too late' });
  assert.equal(afterComplete.status, 400, 'a completed meeting is immutable');
});

test('POST /meetings/:meetingId/start transitions scheduled → in_progress', async () => {
  const { app } = testApp();
  const { projectId, aliceId } = await createWorld(app);
  const meeting = await createMeeting(app, projectId, [aliceId]);

  const res = await request(app).post(`/meetings/${meeting.id}/start`).set('X-User-Id', USER);
  assert.equal(res.status, 200);
  assert.equal(res.body.meeting.status, 'in_progress');
  assert.ok(res.body.meeting.startedAt);
});

test('POST /meetings/:meetingId/decisions records a PI decision with server-set provenance (SPEC-009 #3)', async () => {
  const { app } = testApp();
  const { projectId, aliceId } = await createWorld(app);
  const meeting = await createMeeting(app, projectId, [aliceId]);

  const res = await request(app)
    .post(`/meetings/${meeting.id}/decisions`)
    .set('X-User-Id', USER)
    .send({ statement: 'Adopt a survey-first plan.', rationale: 'Thin evidence.' });
  assert.equal(res.status, 201);
  assert.equal(res.body.decision.madeByType, 'pi', 'madeByType is server-set');
  assert.equal(res.body.decision.madeById, USER, 'madeById is the requester, never client input');
  assert.equal(res.body.decision.meetingId, meeting.id);
  assert.equal(res.body.decision.statement, 'Adopt a survey-first plan.');

  const blank = await request(app)
    .post(`/meetings/${meeting.id}/decisions`)
    .set('X-User-Id', USER)
    .send({ statement: '  ' });
  assert.equal(blank.status, 400);
});

test('action items generate follow-up Tasks in the Meeting’s Project (SPEC-009 #4)', async () => {
  const { app } = testApp();
  const { projectId, aliceId } = await createWorld(app);
  const meeting = await createMeeting(app, projectId, [aliceId]);

  const itemRes = await request(app)
    .post(`/meetings/${meeting.id}/action-items`)
    .set('X-User-Id', USER)
    .send({ title: 'Draft the report', assigneeAgentId: aliceId });
  assert.equal(itemRes.status, 201);
  const itemId = itemRes.body.actionItem.id as string;
  assert.equal(itemRes.body.actionItem.taskId, null);

  const taskRes = await request(app)
    .post(`/meetings/${meeting.id}/action-items/${itemId}/tasks`)
    .set('X-User-Id', USER);
  assert.equal(taskRes.status, 201);
  assert.equal(taskRes.body.task.title, 'Draft the report');
  assert.equal(taskRes.body.task.assigneeAgentId, aliceId);
  assert.equal(taskRes.body.task.projectId, projectId, 'the follow-up task lands in the Meeting’s Project');
  assert.equal(taskRes.body.actionItem.taskId, taskRes.body.task.id, 'the link is recorded');

  const detail = await request(app).get(`/meetings/${meeting.id}`).set('X-User-Id', USER);
  assert.deepEqual(detail.body.resultingTaskIds, [taskRes.body.task.id]);
});

test('completing a Meeting writes Project + Lab memory and exposes the ids (SPEC-009 #5, #6)', async () => {
  const { app } = testApp();
  const { labId, projectId, aliceId } = await createWorld(app);
  const meeting = await createMeeting(app, projectId, [aliceId]);
  await request(app)
    .post(`/meetings/${meeting.id}/decisions`)
    .set('X-User-Id', USER)
    .send({ statement: 'Survey first.' });

  const res = await request(app).post(`/meetings/${meeting.id}/complete`).set('X-User-Id', USER);
  assert.equal(res.status, 200);
  assert.equal(res.body.meeting.status, 'completed');
  assert.ok(res.body.meeting.endedAt);
  assert.equal(res.body.memoryWriteIds.length, 2, 'one project + one lab memory row');
  assert.equal(res.body.decisions.length, 1);

  // The memory rows carry the meeting provenance and are readable via the API.
  const memoryRes = await request(app).get(`/labs/${labId}/memory`).set('X-User-Id', USER);
  const meetingRows = memoryRes.body.memories.filter((m: { sourceType: string }) => m.sourceType === 'meeting');
  assert.equal(meetingRows.length, 2);
  assert.ok(meetingRows.every((m: { sourceId: string }) => m.sourceId === meeting.id));
  assert.ok(
    meetingRows.some((m: { scope: string; scopeId: string }) => m.scope === 'project' && m.scopeId === projectId),
    'project-scoped outcome memory is linked to the Project',
  );

  // Completion is a structured record, not just a transcript.
  assert.deepEqual(
    Object.keys(res.body).sort(),
    ['actionItems', 'decisions', 'meeting', 'memoryWriteIds', 'participants', 'project', 'resultingTaskIds', 'updates'],
  );
});

test('completing a Meeting twice is idempotent — no duplicate memory rows', async () => {
  const { app } = testApp();
  const { labId, projectId, aliceId } = await createWorld(app);
  const meeting = await createMeeting(app, projectId, [aliceId]);

  await request(app).post(`/meetings/${meeting.id}/complete`).set('X-User-Id', USER);
  await request(app).post(`/meetings/${meeting.id}/complete`).set('X-User-Id', USER);

  const memoryRes = await request(app)
    .get(`/labs/${labId}/memory?scope=project&scopeId=${projectId}`)
    .set('X-User-Id', USER);
  const meetingRows = memoryRes.body.memories.filter((m: { sourceType: string }) => m.sourceType === 'meeting');
  assert.equal(meetingRows.length, 1, 'only the project-scoped write, once');
});
