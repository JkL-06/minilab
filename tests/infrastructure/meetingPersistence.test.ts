import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgent } from '../../src/domain/agent';
import { createArtifact } from '../../src/domain/artifact';
import { createDecision } from '../../src/domain/decision';
import { createLab } from '../../src/domain/lab';
import {
  createActionItem,
  createMeeting,
  createMeetingParticipant,
  createMeetingUpdate,
  linkActionItemTask,
} from '../../src/domain/meeting';
import { createProject } from '../../src/domain/project';
import { createTask } from '../../src/domain/task';
import { openDatabase } from '../../src/infrastructure/db/database';
import { SqliteAgentRepository } from '../../src/infrastructure/db/sqliteAgentRepository';
import { SqliteArtifactRepository } from '../../src/infrastructure/db/sqliteArtifactRepository';
import { SqliteDecisionRepository } from '../../src/infrastructure/db/sqliteDecisionRepository';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteMeetingRepository } from '../../src/infrastructure/db/sqliteMeetingRepository';
import { SqliteProjectRepository } from '../../src/infrastructure/db/sqliteProjectRepository';
import { SqliteTaskRepository } from '../../src/infrastructure/db/sqliteTaskRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

/** Opens a temp DB and seeds Lab + Agent + Project rows the meeting FKs reference. */
function seededDb() {
  const path = tempDbPath();
  const db = openDatabase(path);
  const labRepo = new SqliteLabRepository(db);
  const agentRepo = new SqliteAgentRepository(db);
  const projectRepo = new SqliteProjectRepository(db);

  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labRepo.insert(lab);
  const alice = createAgent({ labId: lab.id, name: 'Alice' });
  agentRepo.insert(alice);
  const project = createProject({ labId: lab.id, title: 'Survey' });
  projectRepo.insert(project);

  return {
    path,
    db,
    labRepo,
    agentRepo,
    projectRepo,
    lab,
    alice,
    project,
    meetings: new SqliteMeetingRepository(db),
    decisions: new SqliteDecisionRepository(db),
  };
}

test('meetings, updates, participants, action items, and decisions persist across a reopen (SPEC-009)', () => {
  let path = '';
  let meetingId: string;
  let taskId: string;
  let aliceId: string;
  let projectId: string;
  try {
    // --- First "process" ---
    {
      const seeded = seededDb();
      path = seeded.path;
      aliceId = seeded.alice.id;
      projectId = seeded.project.id;

      const taskRepo = new SqliteTaskRepository(seeded.db);
      const task = createTask({
        projectId,
        creatorType: 'pi',
        creatorId: 'user-1',
        assigneeAgentId: aliceId,
        title: 'Map evidence',
      });
      taskRepo.insert(task);
      taskId = task.id;

      const artifactRepo = new SqliteArtifactRepository(seeded.db);
      artifactRepo.insert(
        createArtifact({
          projectId,
          taskId,
          creatorAgentId: aliceId,
          title: 'Evidence map',
          content: 'Map body.',
          type: 'map',
        }),
      );

      const meeting = createMeeting({ labId: seeded.lab.id, projectId, title: 'Sprint sync', agenda: 'Review.' });
      meetingId = meeting.id;
      seeded.meetings.insertMeeting(meeting);
      seeded.meetings.insertParticipant(createMeetingParticipant(meetingId, aliceId));
      seeded.meetings.insertUpdate(
        createMeetingUpdate({
          meetingId,
          agentId: aliceId,
          content: "Tasks: 'Map evidence' (backlog). Artifacts: 'Evidence map' (map, v1).",
          taskIds: [taskId],
          artifactIds: ['artifact-1'],
        }),
      );

      const item = createActionItem({ meetingId, projectId, title: 'Write up', assigneeAgentId: aliceId });
      seeded.meetings.insertActionItem(linkActionItemTask(item, taskId));

      seeded.decisions.insert(
        createDecision({
          labId: seeded.lab.id,
          projectId,
          meetingId,
          madeByType: 'pi',
          madeById: 'user-1',
          statement: 'Survey first.',
          rationale: 'Thin evidence.',
        }),
      );

      seeded.db.close();
    }

    // --- Simulated restart ---
    {
      const db = openDatabase(path);
      const meetings = new SqliteMeetingRepository(db);
      const decisions = new SqliteDecisionRepository(db);

      const reloaded = meetings.findMeetingById(meetingId);
      assert.ok(reloaded, 'meeting survives reopen');
      assert.equal(reloaded!.title, 'Sprint sync');
      assert.equal(reloaded!.status, 'scheduled');
      assert.equal(reloaded!.agenda, 'Review.');

      const participants = meetings.findParticipants(meetingId);
      assert.deepEqual(participants, [{ meetingId, agentId: aliceId }]);

      const updates = meetings.findUpdates(meetingId);
      assert.equal(updates.length, 1);
      assert.deepEqual(updates[0].taskIds, [taskId], 'JSON array columns round-trip');
      assert.deepEqual(updates[0].artifactIds, ['artifact-1']);

      const items = meetings.findActionItems(meetingId);
      assert.equal(items.length, 1);
      assert.equal(items[0].taskId, taskId, 'action item → task link persists');

      const meetingDecisions = decisions.findByMeeting(meetingId);
      assert.equal(meetingDecisions.length, 1);
      assert.equal(meetingDecisions[0].madeById, 'user-1');

      const listed = meetings.findMeetingsByProject(projectId);
      assert.deepEqual(listed.map((m) => m.id), [meetingId], 'project listing includes the meeting');

      db.close();
    }
  } finally {
    if (path) cleanupTempDb(path);
  }
});

test('updateMeeting persists status/timestamps; updateActionItem persists the task link', () => {
  let path = '';
  try {
    let meetingId: string;
    let itemId: string;
    let taskId: string;
    {
      const seeded = seededDb();
      path = seeded.path;
      const taskRepo = new SqliteTaskRepository(seeded.db);
      const task = createTask({
        projectId: seeded.project.id,
        creatorType: 'pi',
        creatorId: 'user-1',
        assigneeAgentId: seeded.alice.id,
        title: 'Map evidence',
      });
      taskRepo.insert(task);
      taskId = task.id;

      const meeting = createMeeting({ labId: seeded.lab.id, projectId: seeded.project.id, title: 'Sync' });
      meetingId = meeting.id;
      seeded.meetings.insertMeeting(meeting);

      const item = createActionItem({ meetingId, projectId: seeded.project.id, title: 'Write up', assigneeAgentId: seeded.alice.id });
      itemId = item.id;
      seeded.meetings.insertActionItem(item);

      seeded.meetings.updateMeeting({
        ...meeting,
        status: 'in_progress',
        startedAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      });
      seeded.meetings.updateActionItem(linkActionItemTask(item, taskId));

      seeded.db.close();
    }
    {
      const db = openDatabase(path);
      const meetings = new SqliteMeetingRepository(db);
      const reloaded = meetings.findMeetingById(meetingId);
      assert.equal(reloaded!.status, 'in_progress');
      assert.equal(reloaded!.startedAt, '2026-08-15T00:00:00.000Z');

      const item = meetings.findActionItemById(itemId);
      assert.equal(item!.taskId, taskId, 'the follow-up task link persists');
      db.close();
    }
  } finally {
    if (path) cleanupTempDb(path);
  }
});
