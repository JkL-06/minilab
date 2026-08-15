import assert from 'node:assert/strict';
import test from 'node:test';

import { MeetingService } from '../../src/application/meetingService';
import {
  AgentNotFoundError,
  ActionItemNotFoundError,
  LabForbiddenError,
  MeetingNotFoundError,
  MeetingValidationError,
  ProjectNotFoundError,
} from '../../src/domain/errors';
import { createAgent } from '../../src/domain/agent';
import { createArtifact } from '../../src/domain/artifact';
import { createLab } from '../../src/domain/lab';
import { createProject } from '../../src/domain/project';
import { createTask } from '../../src/domain/task';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryArtifactRepository } from '../support/inMemoryArtifactRepository';
import { inMemoryDecisionRepository } from '../support/inMemoryDecisionRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryMeetingRepository } from '../support/inMemoryMeetingRepository';
import { inMemoryMemoryRepository } from '../support/inMemoryMemoryRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { MemoryService } from '../../src/application/memoryService';
import { TaskService } from '../../src/application/taskService';

/** Builds a MeetingService over in-memory repos with a populated Lab world. */
function makeWorld() {
  const labs = inMemoryLabRepository();
  const agents = inMemoryAgentRepository();
  const projects = inMemoryProjectRepository();
  const tasks = inMemoryTaskRepository();
  const artifacts = inMemoryArtifactRepository();
  const taskService = new TaskService(tasks, projects, agents, labs);
  const memoryService = new MemoryService(
    inMemoryMemoryRepository(),
    labs,
    agents,
    projects,
    new KeywordMemorySearch(),
  );
  const meetings = inMemoryMeetingRepository();
  const decisions = inMemoryDecisionRepository();
  const service = new MeetingService(
    meetings,
    decisions,
    projects,
    labs,
    agents,
    tasks,
    artifacts,
    taskService,
    memoryService,
  );

  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const alice = createAgent({ labId: lab.id, name: 'Alice' });
  const bob = createAgent({ labId: lab.id, name: 'Bob' });
  agents.insert(alice);
  agents.insert(bob);
  const project = createProject({ labId: lab.id, title: 'Survey' });
  projects.insert(project);

  const aliceTask = createTask({
    projectId: project.id,
    creatorType: 'pi',
    creatorId: 'user-1',
    assigneeAgentId: alice.id,
    title: 'Map evidence',
  });
  const aliceArtifact = createArtifact({
    projectId: project.id,
    taskId: aliceTask.id,
    creatorAgentId: alice.id,
    title: 'Evidence map',
    content: 'Map of 40 studies.',
    type: 'map',
  });
  tasks.insert(aliceTask);
  artifacts.insert(aliceArtifact);

  return { service, meetings, decisions, labs, agents, projects, tasks, artifacts, memoryService, lab, project, alice, bob, aliceTask, aliceArtifact };
}

test('createMeeting prepares a Meeting with grounded participant updates (SPEC-009 #1, #2)', () => {
  const { service, project, alice, bob, aliceTask, aliceArtifact } = makeWorld();

  const meeting = service.createMeeting('user-1', project.id, {
    title: 'Sprint sync',
    agenda: 'Review the survey plan.',
    participantAgentIds: [alice.id, bob.id],
  });

  assert.equal(meeting.type, 'group_meeting');
  assert.equal(meeting.projectId, project.id);
  assert.equal(meeting.status, 'scheduled');
  assert.equal(meeting.agenda, 'Review the survey plan.');

  const detail = service.getMeetingDetail('user-1', meeting.id);
  assert.deepEqual(
    detail.participants.map((p) => p.agentId).sort(),
    [alice.id, bob.id].sort(),
    'Alice and Bob attend (acceptance #1)',
  );

  // Bob has no work in the project → his update is the empty grounding summary.
  const aliceUpdate = detail.updates.find((u) => u.agentId === alice.id)!;
  assert.equal(aliceUpdate.content, `Tasks: 'Map evidence' (backlog). Artifacts: 'Evidence map' (map, v1).`);
  assert.deepEqual(aliceUpdate.taskIds, [aliceTask.id]);
  assert.deepEqual(aliceUpdate.artifactIds, [aliceArtifact.id]);
  assert.match(aliceUpdate.content, /Map evidence/, 'update is grounded in Alice’s tasks/artifacts');

  const bobUpdate = detail.updates.find((u) => u.agentId === bob.id)!;
  assert.equal(bobUpdate.content, 'Tasks: no tasks in this project. Artifacts: no artifacts in this project.');
  assert.deepEqual(bobUpdate.taskIds, []);
  assert.deepEqual(bobUpdate.artifactIds, []);
});

test('createMeeting rejects missing participants, cross-Lab participants, and unknown projects', () => {
  const { service, projects, agents, lab, project } = makeWorld();
  const otherLab = createLab({ ownerUserId: 'user-1', name: 'Other' });
  const outside = createAgent({ labId: otherLab.id, name: 'Outside' });
  projects.insert(createProject({ labId: otherLab.id, title: 'Other project' }));
  agents.insert(outside);

  assert.throws(
    () => service.createMeeting('user-1', project.id, { title: 'X', participantAgentIds: ['nope'] }),
    AgentNotFoundError,
  );
  assert.throws(
    () => service.createMeeting('user-1', project.id, { title: 'X', participantAgentIds: [outside.id] }),
    MeetingValidationError,
    'participants must belong to the same Lab as the Project',
  );
  assert.throws(
    () => service.createMeeting('user-2', project.id, { title: 'X', participantAgentIds: [lab.id] }),
    LabForbiddenError,
  );
  assert.throws(
    () => service.createMeeting('user-1', 'no-such-project', { title: 'X', participantAgentIds: [lab.id] }),
    ProjectNotFoundError,
  );
});

test('createMeeting rejects an empty participant list (defense-in-depth below the API)', () => {
  const { service, project } = makeWorld();
  assert.throws(
    () => service.createMeeting('user-1', project.id, { title: 'X', participantAgentIds: [] }),
    MeetingValidationError,
  );
});

test('listProjectMeetings returns newest-first and enforces Lab ownership', () => {
  const { service, meetings, project, alice } = makeWorld();
  const m1 = service.createMeeting('user-1', project.id, { title: 'First', participantAgentIds: [alice.id] });
  const m2 = service.createMeeting('user-1', project.id, { title: 'Second', participantAgentIds: [alice.id] });

  // Deterministic ordering: distinct createdAt timestamps.
  meetings.meetings[0].createdAt = '2026-08-15T00:00:01.000Z';
  meetings.meetings[1].createdAt = '2026-08-15T00:00:02.000Z';

  const listed = service.listProjectMeetings('user-1', project.id);
  assert.deepEqual(listed.map((m) => m.id), [m2.id, m1.id], 'newest first');
  assert.throws(() => service.listProjectMeetings('user-2', project.id), LabForbiddenError);
});

test('updateMeeting edits agenda and transcript and rejects edits on a completed meeting', () => {
  const { service, project, alice } = makeWorld();
  const meeting = service.createMeeting('user-1', project.id, { title: 'Sync', participantAgentIds: [alice.id] });

  const updated = service.updateMeeting('user-1', meeting.id, { agenda: 'New agenda', transcript: 'Discussion record.' });
  assert.equal(updated.agenda, 'New agenda');
  assert.equal(updated.transcript, 'Discussion record.');

  service.completeMeeting('user-1', meeting.id);
  assert.throws(
    () => service.updateMeeting('user-1', meeting.id, { agenda: 'X' }),
    MeetingValidationError,
  );
});

test('startMeeting transitions to in_progress and stamps startedAt', () => {
  const { service, project, alice } = makeWorld();
  const meeting = service.createMeeting('user-1', project.id, { title: 'Sync', participantAgentIds: [alice.id] });

  const started = service.startMeeting('user-1', meeting.id);
  assert.equal(started.status, 'in_progress');
  assert.ok(started.startedAt, 'startedAt stamped');
  assert.equal(started.endedAt, null);
});

test('recordDecision stores a PI decision with server-set provenance (SPEC-009 #3)', () => {
  const { service, project, alice } = makeWorld();
  const meeting = service.createMeeting('user-1', project.id, { title: 'Sync', participantAgentIds: [alice.id] });

  const decision = service.recordDecision('user-1', meeting.id, {
    statement: 'Adopt a survey-first plan.',
    rationale: 'Thin evidence base.',
  });

  assert.equal(decision.meetingId, meeting.id);
  assert.equal(decision.projectId, project.id);
  assert.equal(decision.madeByType, 'pi', 'provenance is server-set');
  assert.equal(decision.madeById, 'user-1', 'madeById is the requester, not client input');
  assert.equal(decision.statement, 'Adopt a survey-first plan.');
  assert.equal(decision.rationale, 'Thin evidence base.');

  const detail = service.getMeetingDetail('user-1', meeting.id);
  assert.equal(detail.decisions.length, 1);
  assert.equal(detail.decisions[0].madeById, 'user-1');
});

test('createActionItem and generateTaskFromActionItem create a follow-up Task (SPEC-009 #4)', () => {
  const { service, tasks, project, alice } = makeWorld();
  const meeting = service.createMeeting('user-1', project.id, { title: 'Sync', participantAgentIds: [alice.id] });

  const item = service.createActionItem('user-1', meeting.id, {
    title: 'Draft the report',
    assigneeAgentId: alice.id,
  });
  assert.equal(item.taskId, null);

  const { task, actionItem } = service.generateTaskFromActionItem('user-1', meeting.id, item.id);
  assert.equal(task.title, 'Draft the report', 'the Task title comes from the action item');
  assert.equal(task.assigneeAgentId, alice.id, 'assigned to the action item’s assignee');
  assert.equal(task.projectId, project.id, 'the Task lands in the Meeting’s Project');
  assert.equal(actionItem.taskId, task.id, 'the link is recorded');

  // Idempotent: a second call returns the same Task, no duplicate rows.
  const countAfterFirst = tasks.tasks.length;
  const again = service.generateTaskFromActionItem('user-1', meeting.id, item.id);
  assert.equal(again.task.id, task.id);
  assert.equal(tasks.tasks.length, countAfterFirst, 'no duplicate follow-up task');

  const detail = service.getMeetingDetail('user-1', meeting.id);
  assert.deepEqual(detail.resultingTaskIds, [task.id], 'resulting task ids are exposed');
});

test('generateTaskFromActionItem rejects a missing item and an unassigned item', () => {
  const { service, project, alice } = makeWorld();
  const meeting = service.createMeeting('user-1', project.id, { title: 'Sync', participantAgentIds: [alice.id] });

  assert.throws(
    () => service.generateTaskFromActionItem('user-1', meeting.id, 'nope'),
    ActionItemNotFoundError,
  );

  const unassigned = service.createActionItem('user-1', meeting.id, { title: 'Note only' });
  assert.throws(
    () => service.generateTaskFromActionItem('user-1', meeting.id, unassigned.id),
    MeetingValidationError,
  );
});

test('completeMeeting writes Project + Lab memory with provenance and stays idempotent (SPEC-009 #5, #6)', () => {
  const { service, memoryService, project, alice, bob } = makeWorld();
  const meeting = service.createMeeting('user-1', project.id, {
    title: 'Sprint sync',
    participantAgentIds: [alice.id, bob.id],
  });
  service.recordDecision('user-1', meeting.id, { statement: 'Survey first.' });

  const detail = service.completeMeeting('user-1', meeting.id);

  assert.equal(detail.meeting.status, 'completed');
  assert.ok(detail.meeting.endedAt, 'endedAt stamped on completion');

  const writes = memoryService.listMemoryBySource('user-1', project.labId, 'meeting', meeting.id);
  assert.equal(writes.length, 2, 'one project + one lab memory row');
  assert.deepEqual(detail.memoryWriteIds.sort(), writes.map((w) => w.id).sort(), 'memory write ids are exposed');
  assert.ok(
    writes.every((w) => w.memoryType === 'meeting' && w.sourceType === 'meeting' && w.sourceId === meeting.id),
    'provenance is on the memory rows (single source of truth)',
  );
  const projectWrite = writes.find((w) => w.scope === 'project');
  assert.equal(projectWrite!.scopeId, project.id);
  assert.match(projectWrite!.content, /Survey first\./, 'the decision appears in the outcome summary');

  // Idempotent: completing again writes no duplicate memory.
  const again = service.completeMeeting('user-1', meeting.id);
  assert.equal(again.meeting.status, 'completed');
  assert.equal(
    memoryService.listMemoryBySource('user-1', project.labId, 'meeting', meeting.id).length,
    2,
    'no duplicate memory on a second completion',
  );
});

test('completeMeeting is the structured record, not just a transcript (SPEC-009 #6)', () => {
  const { service, project, alice, bob } = makeWorld();
  const meeting = service.createMeeting('user-1', project.id, { title: 'Sync', participantAgentIds: [alice.id, bob.id] });
  const item = service.createActionItem('user-1', meeting.id, { title: 'Write up', assigneeAgentId: alice.id });
  const { task } = service.generateTaskFromActionItem('user-1', meeting.id, item.id);
  service.recordDecision('user-1', meeting.id, { statement: 'Go.' });

  const detail = service.completeMeeting('user-1', meeting.id);
  assert.equal(detail.participants.length, 2);
  assert.equal(detail.updates.length, 2, 'participant updates are part of the record');
  assert.equal(detail.decisions.length, 1);
  assert.equal(detail.actionItems.length, 1);
  assert.deepEqual(detail.resultingTaskIds, [task.id]);
  assert.equal(detail.memoryWriteIds.length, 2);
});

test('getMeetingDetail rejects a missing meeting and a cross-Lab requester', () => {
  const { service, project, alice } = makeWorld();
  const meeting = service.createMeeting('user-1', project.id, { title: 'Sync', participantAgentIds: [alice.id] });

  assert.throws(() => service.getMeetingDetail('user-1', 'nope'), MeetingNotFoundError);
  assert.throws(() => service.getMeetingDetail('user-2', meeting.id), LabForbiddenError);
});

test('recordDecision and action items are rejected on a completed meeting', () => {
  const { service, project, alice } = makeWorld();
  const meeting = service.createMeeting('user-1', project.id, { title: 'Sync', participantAgentIds: [alice.id] });
  const item = service.createActionItem('user-1', meeting.id, { title: 'X', assigneeAgentId: alice.id });
  service.completeMeeting('user-1', meeting.id);

  assert.throws(
    () => service.recordDecision('user-1', meeting.id, { statement: 'Late.' }),
    MeetingValidationError,
  );
  assert.throws(
    () => service.createActionItem('user-1', meeting.id, { title: 'Late item' }),
    MeetingValidationError,
  );
  // completed ⇒ generateTaskFromActionItem rejects too (the item predates completion)
  assert.throws(
    () => service.generateTaskFromActionItem('user-1', meeting.id, item.id),
    MeetingValidationError,
  );
});
