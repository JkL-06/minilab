import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyMeetingUpdate,
  assertMeetingStatusTransition,
  createActionItem,
  createMeeting,
  createMeetingParticipant,
  createMeetingUpdate,
  DEFAULT_MEETING_STATUS,
  linkActionItemTask,
  transitionMeetingStatus,
  validateMeetingAgenda,
  validateMeetingTitle,
  validateMeetingTranscript,
  validateMeetingUpdateContent,
  validateActionItemTitle,
} from '../../src/domain/meeting';
import { MeetingValidationError } from '../../src/domain/errors';

function baseInput(overrides: Partial<Parameters<typeof createMeeting>[0]> = {}) {
  return { labId: 'lab-1', projectId: 'project-1', title: 'Sprint sync', ...overrides };
}

test('createMeeting builds a scheduled group_meeting in one Project (SPEC-009)', () => {
  const meeting = createMeeting(baseInput({ agenda: 'Review tasks' }));

  assert.ok(meeting.id, 'immutable UUIDv4 id');
  assert.equal(meeting.labId, 'lab-1');
  assert.equal(meeting.projectId, 'project-1');
  assert.equal(meeting.type, 'group_meeting');
  assert.equal(meeting.title, 'Sprint sync');
  assert.equal(meeting.agenda, 'Review tasks');
  assert.equal(meeting.transcript, null);
  assert.equal(meeting.status, DEFAULT_MEETING_STATUS);
  assert.equal(meeting.startedAt, null);
  assert.equal(meeting.endedAt, null);
  assert.match(meeting.createdAt, /Z$/, 'UTC ISO-8601 timestamp');
  assert.equal(meeting.updatedAt, meeting.createdAt);
});

test('createMeeting defaults agenda to null and trims the title', () => {
  const meeting = createMeeting(baseInput({ title: '  Sprint sync  ' }));
  assert.equal(meeting.title, 'Sprint sync');
  assert.equal(meeting.agenda, null);
});

test('createMeeting rejects an empty or oversized title/agenda', () => {
  assert.throws(() => createMeeting(baseInput({ title: '   ' })), MeetingValidationError);
  assert.throws(() => createMeeting(baseInput({ title: 'x'.repeat(301) })), MeetingValidationError);
  assert.throws(
    () => createMeeting(baseInput({ agenda: 'x'.repeat(20_001) })),
    MeetingValidationError,
  );
});

test('applyMeetingUpdate edits agenda and transcript and bumps updatedAt', () => {
  const meeting = createMeeting(baseInput());
  const updated = applyMeetingUpdate(meeting, {
    agenda: 'New agenda',
    transcript: 'Alice reported; PI decided.',
  });

  assert.equal(updated.agenda, 'New agenda');
  assert.equal(updated.transcript, 'Alice reported; PI decided.');
  assert.equal(updated.id, meeting.id, 'update is in place, not a new row');
  assert.equal(updated.status, 'scheduled', 'content edits do not change status');
  assert.ok(Date.parse(updated.updatedAt) >= Date.parse(meeting.updatedAt));
});

test('applyMeetingUpdate clears agenda/transcript with null and validates lengths', () => {
  const meeting = createMeeting(baseInput({ agenda: 'Old' }));
  const cleared = applyMeetingUpdate(meeting, { agenda: null, transcript: null });
  assert.equal(cleared.agenda, null);
  assert.equal(cleared.transcript, null);

  assert.throws(
    () => applyMeetingUpdate(meeting, { transcript: 'x'.repeat(100_001) }),
    MeetingValidationError,
  );
});

test('transitionMeetingStatus follows scheduled → in_progress → completed', () => {
  const now = '2026-08-15T00:00:00.000Z';
  const meeting = createMeeting(baseInput());

  const started = transitionMeetingStatus(meeting, 'in_progress', now);
  assert.equal(started.status, 'in_progress');
  assert.equal(started.startedAt, now, 'entering in_progress stamps startedAt');
  assert.equal(started.endedAt, null);

  const completed = transitionMeetingStatus(started, 'completed', '2026-08-15T00:05:00.000Z');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.endedAt, '2026-08-15T00:05:00.000Z', 'entering completed stamps endedAt');
  assert.equal(completed.startedAt, now, 'startedAt is preserved');
});

test('transitionMeetingStatus identity transitions are idempotent', () => {
  const now = '2026-08-15T00:00:00.000Z';
  const completed = transitionMeetingStatus(
    transitionMeetingStatus(createMeeting(baseInput()), 'completed', now),
    'completed',
    '2026-08-15T00:10:00.000Z',
  );
  assert.equal(completed.status, 'completed');
  assert.equal(completed.endedAt, now, 'a repeated completion does not touch the timestamp');
});

test('transitionMeetingStatus rejects illegal transitions', () => {
  const meeting = createMeeting(baseInput());
  assert.throws(() => transitionMeetingStatus(meeting, 'whatever' as never, 'now'), MeetingValidationError);
  assert.throws(() => assertMeetingStatusTransition('completed', 'in_progress'), MeetingValidationError);
});

test('createMeetingParticipant and createMeetingUpdate build grounded updates', () => {
  const participant = createMeetingParticipant('meeting-1', 'agent-1');
  assert.deepEqual(participant, { meetingId: 'meeting-1', agentId: 'agent-1' });
  assert.throws(() => createMeetingParticipant('', 'agent-1'), MeetingValidationError);
  assert.throws(() => createMeetingParticipant('meeting-1', ' '), MeetingValidationError);

  const update = createMeetingUpdate({
    meetingId: 'meeting-1',
    agentId: 'agent-1',
    content: "Tasks: 'Map evidence' (backlog). Artifacts: 'Map' (note, v1).",
    taskIds: ['task-1'],
    artifactIds: ['artifact-1'],
  });
  assert.ok(update.id);
  assert.equal(update.agentId, 'agent-1');
  assert.deepEqual(update.taskIds, ['task-1']);
  assert.deepEqual(update.artifactIds, ['artifact-1']);
  assert.match(update.createdAt, /Z$/);
});

test('meeting update validators reject empty content and oversized content', () => {
  assert.throws(() => createMeetingUpdate({
    meetingId: 'm',
    agentId: 'a',
    content: '  ',
    taskIds: [],
    artifactIds: [],
  }), MeetingValidationError);
  assert.throws(() => createMeetingUpdate({
    meetingId: 'm',
    agentId: 'a',
    content: 'x'.repeat(20_001),
    taskIds: [],
    artifactIds: [],
  }), MeetingValidationError);
  assert.equal(validateMeetingUpdateContent('  ok  '), 'ok');
});

test('createActionItem starts unassigned with no task link; linkActionItemTask records the task once', () => {
  const item = createActionItem({
    meetingId: 'meeting-1',
    projectId: 'project-1',
    title: '  Draft the report  ',
  });
  assert.ok(item.id);
  assert.equal(item.title, 'Draft the report');
  assert.equal(item.assigneeAgentId, null);
  assert.equal(item.taskId, null);
  assert.match(item.createdAt, /Z$/);

  const assigned = createActionItem({
    meetingId: 'meeting-1',
    projectId: 'project-1',
    title: 'Write up',
    assigneeAgentId: 'agent-1',
  });
  assert.equal(assigned.assigneeAgentId, 'agent-1');

  const linked = linkActionItemTask(assigned, 'task-9');
  assert.equal(linked.taskId, 'task-9');
  assert.equal(linked.id, assigned.id, 'linking is in place');
  assert.throws(() => linkActionItemTask(assigned, '  '), MeetingValidationError);
});

test('title validators reject empty and oversized values', () => {
  assert.equal(validateMeetingTitle('  Sync  '), 'Sync');
  assert.throws(() => validateMeetingTitle(7 as never), MeetingValidationError);
  assert.throws(() => validateMeetingTitle('x'.repeat(301)), MeetingValidationError);
  assert.equal(validateActionItemTitle('  Draft  '), 'Draft');
  assert.throws(() => validateActionItemTitle('   '), MeetingValidationError);
  assert.throws(() => validateActionItemTitle('x'.repeat(301)), MeetingValidationError);
  assert.equal(validateMeetingAgenda('  a  '), 'a');
  assert.equal(validateMeetingTranscript('  t  '), 't');
});
