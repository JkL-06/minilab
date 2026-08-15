import type { MeetingRepository } from '../../src/application/meetingRepository';
import type {
  ActionItem,
  Meeting,
  MeetingParticipant,
  MeetingUpdate,
} from '../../src/domain/meeting';

/**
 * In-memory MeetingRepository for service/API tests. Not used by the persistence
 * and restart tests, which exercise the real SQLite repository. Listings match
 * the SQLite ordering: meetings newest-first; updates/participants/action items
 * in insertion order.
 */
export function inMemoryMeetingRepository(): MeetingRepository & {
  meetings: Meeting[];
  participants: MeetingParticipant[];
  updates: MeetingUpdate[];
  actionItems: ActionItem[];
} {
  const meetings: Meeting[] = [];
  const participants: MeetingParticipant[] = [];
  const updates: MeetingUpdate[] = [];
  const actionItems: ActionItem[] = [];
  return {
    meetings,
    participants,
    updates,
    actionItems,

    insertMeeting(meeting: Meeting): void {
      meetings.push(meeting);
    },
    findMeetingById(id: string): Meeting | null {
      return meetings.find((meeting) => meeting.id === id) ?? null;
    },
    findMeetingsByProject(projectId: string): Meeting[] {
      return meetings
        .filter((meeting) => meeting.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    updateMeeting(meeting: Meeting): void {
      const index = meetings.findIndex((m) => m.id === meeting.id);
      if (index >= 0) meetings[index] = meeting;
    },

    insertParticipant(participant: MeetingParticipant): void {
      participants.push(participant);
    },
    findParticipants(meetingId: string): MeetingParticipant[] {
      return participants.filter((p) => p.meetingId === meetingId);
    },

    insertUpdate(update: MeetingUpdate): void {
      updates.push(update);
    },
    findUpdates(meetingId: string): MeetingUpdate[] {
      return updates.filter((update) => update.meetingId === meetingId);
    },

    insertActionItem(item: ActionItem): void {
      actionItems.push(item);
    },
    findActionItemById(id: string): ActionItem | null {
      return actionItems.find((item) => item.id === id) ?? null;
    },
    findActionItems(meetingId: string): ActionItem[] {
      return actionItems.filter((item) => item.meetingId === meetingId);
    },
    updateActionItem(item: ActionItem): void {
      const index = actionItems.findIndex((x) => x.id === item.id);
      if (index >= 0) actionItems[index] = item;
    },
  };
}
