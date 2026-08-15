import type { MeetingRepository } from '../../application/meetingRepository';
import type {
  ActionItem,
  Meeting,
  MeetingParticipant,
  MeetingStatus,
  MeetingUpdate,
} from '../../domain/meeting';
import type { MiniLabDb } from './database';

interface MeetingRow {
  id: string;
  lab_id: string;
  project_id: string;
  type: string;
  title: string;
  agenda: string | null;
  transcript: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ParticipantRow {
  meeting_id: string;
  agent_id: string;
}

interface MeetingUpdateRow {
  id: string;
  meeting_id: string;
  agent_id: string;
  content: string;
  task_ids: string;
  artifact_ids: string;
  created_at: string;
}

interface ActionItemRow {
  id: string;
  meeting_id: string;
  project_id: string;
  title: string;
  assignee_agent_id: string | null;
  task_id: string | null;
  created_at: string;
}

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    type: row.type as Meeting['type'],
    title: row.title,
    agenda: row.agenda,
    transcript: row.transcript,
    status: row.status as MeetingStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMeetingRow(meeting: Meeting): MeetingRow {
  return {
    id: meeting.id,
    lab_id: meeting.labId,
    project_id: meeting.projectId,
    type: meeting.type,
    title: meeting.title,
    agenda: meeting.agenda,
    transcript: meeting.transcript,
    status: meeting.status,
    started_at: meeting.startedAt,
    ended_at: meeting.endedAt,
    created_at: meeting.createdAt,
    updated_at: meeting.updatedAt,
  };
}

function toParticipant(row: ParticipantRow): MeetingParticipant {
  return { meetingId: row.meeting_id, agentId: row.agent_id };
}

function toMeetingUpdate(row: MeetingUpdateRow): MeetingUpdate {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    agentId: row.agent_id,
    content: row.content,
    taskIds: JSON.parse(row.task_ids) as string[],
    artifactIds: JSON.parse(row.artifact_ids) as string[],
    createdAt: row.created_at,
  };
}

function toMeetingUpdateRow(update: MeetingUpdate): MeetingUpdateRow {
  return {
    id: update.id,
    meeting_id: update.meetingId,
    agent_id: update.agentId,
    content: update.content,
    task_ids: JSON.stringify(update.taskIds),
    artifact_ids: JSON.stringify(update.artifactIds),
    created_at: update.createdAt,
  };
}

function toActionItem(row: ActionItemRow): ActionItem {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    projectId: row.project_id,
    title: row.title,
    assigneeAgentId: row.assignee_agent_id,
    taskId: row.task_id,
    createdAt: row.created_at,
  };
}

function toActionItemRow(item: ActionItem): ActionItemRow {
  return {
    id: item.id,
    meeting_id: item.meetingId,
    project_id: item.projectId,
    title: item.title,
    assignee_agent_id: item.assigneeAgentId,
    task_id: item.taskId,
    created_at: item.createdAt,
  };
}

/**
 * SQLite-backed MeetingRepository (SPEC-009, ADR-0005). Owns the meeting rows
 * and their meeting-scoped sub-rows. Meetings list newest-first; decisions and
 * updates are queried via their own repositories/aggregate methods.
 */
export class SqliteMeetingRepository implements MeetingRepository {
  constructor(private readonly db: MiniLabDb) {}

  insertMeeting(meeting: Meeting): void {
    this.db
      .prepare(
        `INSERT INTO meetings
           (id, lab_id, project_id, type, title, agenda, transcript, status,
            started_at, ended_at, created_at, updated_at)
         VALUES
           (@id, @lab_id, @project_id, @type, @title, @agenda, @transcript, @status,
            @started_at, @ended_at, @created_at, @updated_at)`,
      )
      .run(toMeetingRow(meeting));
  }

  findMeetingById(id: string): Meeting | null {
    const row = this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
      | MeetingRow
      | undefined;
    return row ? toMeeting(row) : null;
  }

  findMeetingsByProject(projectId: string): Meeting[] {
    const rows = this.db
      .prepare('SELECT * FROM meetings WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as MeetingRow[];
    return rows.map(toMeeting);
  }

  updateMeeting(meeting: Meeting): void {
    this.db
      .prepare(
        `UPDATE meetings SET
           agenda = @agenda, transcript = @transcript, status = @status,
           started_at = @started_at, ended_at = @ended_at, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(toMeetingRow(meeting));
  }

  insertParticipant(participant: MeetingParticipant): void {
    this.db
      .prepare('INSERT INTO meeting_participants (meeting_id, agent_id) VALUES (?, ?)')
      .run(participant.meetingId, participant.agentId);
  }

  findParticipants(meetingId: string): MeetingParticipant[] {
    const rows = this.db
      .prepare('SELECT * FROM meeting_participants WHERE meeting_id = ? ORDER BY agent_id')
      .all(meetingId) as ParticipantRow[];
    return rows.map(toParticipant);
  }

  insertUpdate(update: MeetingUpdate): void {
    const row = toMeetingUpdateRow(update);
    this.db
      .prepare(
        `INSERT INTO meeting_updates
           (id, meeting_id, agent_id, content, task_ids, artifact_ids, created_at)
         VALUES
           (@id, @meeting_id, @agent_id, @content, @task_ids, @artifact_ids, @created_at)`,
      )
      .run(row);
  }

  findUpdates(meetingId: string): MeetingUpdate[] {
    const rows = this.db
      .prepare('SELECT * FROM meeting_updates WHERE meeting_id = ? ORDER BY created_at')
      .all(meetingId) as MeetingUpdateRow[];
    return rows.map(toMeetingUpdate);
  }

  insertActionItem(item: ActionItem): void {
    const row = toActionItemRow(item);
    this.db
      .prepare(
        `INSERT INTO action_items
           (id, meeting_id, project_id, title, assignee_agent_id, task_id, created_at)
         VALUES
           (@id, @meeting_id, @project_id, @title, @assignee_agent_id, @task_id, @created_at)`,
      )
      .run(row);
  }

  findActionItemById(id: string): ActionItem | null {
    const row = this.db.prepare('SELECT * FROM action_items WHERE id = ?').get(id) as
      | ActionItemRow
      | undefined;
    return row ? toActionItem(row) : null;
  }

  findActionItems(meetingId: string): ActionItem[] {
    const rows = this.db
      .prepare('SELECT * FROM action_items WHERE meeting_id = ? ORDER BY created_at')
      .all(meetingId) as ActionItemRow[];
    return rows.map(toActionItem);
  }

  updateActionItem(item: ActionItem): void {
    this.db
      .prepare('UPDATE action_items SET assignee_agent_id = ?, task_id = ? WHERE id = ?')
      .run(item.assigneeAgentId, item.taskId, item.id);
  }
}
