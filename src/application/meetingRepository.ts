import type {
  ActionItem,
  Meeting,
  MeetingParticipant,
  MeetingUpdate,
} from '../domain/meeting';

/**
 * Persistence boundary for the Group Meeting aggregate (SPEC-009, ADR-0005).
 * One repository owns the meeting rows and their meeting-scoped sub-rows
 * (participants join table, structured updates, action items). Implementations
 * are SQLite-backed in production and in-memory in service/API tests.
 */
export interface MeetingRepository {
  insertMeeting(meeting: Meeting): void;
  findMeetingById(id: string): Meeting | null;
  /** All meetings of a Project, newest first. */
  findMeetingsByProject(projectId: string): Meeting[];
  updateMeeting(meeting: Meeting): void;

  insertParticipant(participant: MeetingParticipant): void;
  findParticipants(meetingId: string): MeetingParticipant[];

  insertUpdate(update: MeetingUpdate): void;
  findUpdates(meetingId: string): MeetingUpdate[];

  insertActionItem(item: ActionItem): void;
  findActionItemById(id: string): ActionItem | null;
  findActionItems(meetingId: string): ActionItem[];
  updateActionItem(item: ActionItem): void;
}
