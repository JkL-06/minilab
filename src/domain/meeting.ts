import { randomUUID } from 'node:crypto';

import { MeetingValidationError } from './errors';

/**
 * Group Meeting (SPEC-009, ADR-0005).
 *
 * A Meeting realizes DOMAIN_MODEL's `Event` entity for the MVP event type
 * `group_meeting`: Alice, Bob, and the PI turn distributed project work into
 * decisions and follow-up tasks. The workflow is
 * `Prepare → Updates → Discussion → PI Decision → Action Items → Tasks → Memory`.
 *
 * A Meeting belongs to exactly one Project (acceptance #1) and therefore, through
 * the Project → Lab chain, to exactly one Lab — cross-Lab meetings are impossible
 * (DOMAIN_MODEL invariant #5). It stores its agenda and a transcript/discussion
 * record, but completion is *never represented only by a transcript* (acceptance
 * #6): the structured outcome (participant updates, decisions, action items,
 * resulting task ids, memory write ids) is what makes the meeting a first-class
 * record.
 *
 * Status is a deterministic state machine: `scheduled → in_progress → completed`,
 * with identity self-loops so retries stay idempotent and `completed` is terminal
 * (a completed meeting is immutable).
 */
export const MEETING_TYPES: ['group_meeting'] = ['group_meeting'];

export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_STATUSES: ['scheduled', 'in_progress', 'completed'] = [
  'scheduled',
  'in_progress',
  'completed',
];

export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Allowed next statuses per current status (includes the identity transition). */
export const MEETING_STATUS_TRANSITIONS: Record<MeetingStatus, readonly MeetingStatus[]> = {
  scheduled: ['scheduled', 'in_progress', 'completed'],
  in_progress: ['in_progress', 'completed'],
  completed: ['completed'],
};

export const DEFAULT_MEETING_STATUS: MeetingStatus = 'scheduled';

export interface Meeting {
  id: string;
  labId: string;
  projectId: string;
  type: MeetingType;
  title: string;
  agenda: string | null;
  transcript: string | null;
  status: MeetingStatus;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMeetingInput {
  labId: string;
  projectId: string;
  title: string;
  agenda?: string | null;
}

export interface MeetingUpdatePatch {
  agenda?: unknown;
  transcript?: unknown;
}

export function validateMeetingTitle(title: unknown): string {
  if (typeof title !== 'string') {
    throw new MeetingValidationError('title must be a string');
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new MeetingValidationError('title must not be empty');
  }
  if (trimmed.length > 300) {
    throw new MeetingValidationError('title must be at most 300 characters');
  }
  return trimmed;
}

export function validateMeetingAgenda(agenda: unknown): string {
  if (typeof agenda !== 'string') {
    throw new MeetingValidationError('agenda must be a string');
  }
  const trimmed = agenda.trim();
  if (trimmed.length > 20_000) {
    throw new MeetingValidationError('agenda must be at most 20,000 characters');
  }
  return trimmed;
}

export function validateMeetingTranscript(transcript: unknown): string {
  if (typeof transcript !== 'string') {
    throw new MeetingValidationError('transcript must be a string');
  }
  const trimmed = transcript.trim();
  if (trimmed.length > 100_000) {
    throw new MeetingValidationError('transcript must be at most 100,000 characters');
  }
  return trimmed;
}

export function assertMeetingStatusTransition(
  current: MeetingStatus,
  next: MeetingStatus,
): void {
  if (!MEETING_STATUS_TRANSITIONS[current].includes(next)) {
    throw new MeetingValidationError(
      `invalid meeting status transition: ${current} → ${next}`,
    );
  }
}

/**
 * Creates a new Group Meeting (Event of type `group_meeting`) in a Project.
 * New meetings are `scheduled`; nothing is started or recorded yet.
 */
export function createMeeting(input: CreateMeetingInput): Meeting {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    labId: input.labId,
    projectId: input.projectId,
    type: 'group_meeting',
    title: validateMeetingTitle(input.title),
    agenda: input.agenda == null ? null : validateMeetingAgenda(input.agenda),
    transcript: null,
    status: DEFAULT_MEETING_STATUS,
    startedAt: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Applies a content-only update (agenda / transcript). A completed meeting is
 * immutable — the caller rejects status changes; this only edits the record.
 */
export function applyMeetingUpdate(meeting: Meeting, patch: MeetingUpdatePatch): Meeting {
  const next: Meeting = { ...meeting };
  if ('agenda' in patch) {
    next.agenda = patch.agenda == null ? null : validateMeetingAgenda(patch.agenda);
  }
  if ('transcript' in patch) {
    next.transcript =
      patch.transcript == null ? null : validateMeetingTranscript(patch.transcript);
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * Advances a Meeting along the status state machine. Entering `in_progress`
 * stamps `startedAt`; entering `completed` stamps `endedAt` and makes the record
 * terminal. Identity transitions (e.g. `completed → completed`) are idempotent
 * and do not touch the timestamps.
 */
export function transitionMeetingStatus(
  meeting: Meeting,
  next: MeetingStatus,
  now: string,
): Meeting {
  if (meeting.status === next) {
    return meeting;
  }
  assertMeetingStatusTransition(meeting.status, next);
  return {
    ...meeting,
    status: next,
    startedAt: next === 'in_progress' ? now : meeting.startedAt,
    endedAt: next === 'completed' ? now : meeting.endedAt,
    updatedAt: now,
  };
}

// --- Participants (join table, DOMAIN_MODEL: "Participants live in a join table") ---

export interface MeetingParticipant {
  meetingId: string;
  agentId: string;
}

/** A participant is an Agent attending the Meeting (Alice, Bob, … in v0.1). */
export function createMeetingParticipant(
  meetingId: string,
  agentId: string,
): MeetingParticipant {
  if (meetingId.trim().length === 0) {
    throw new MeetingValidationError('meetingId must not be empty');
  }
  if (agentId.trim().length === 0) {
    throw new MeetingValidationError('agentId must not be empty');
  }
  return { meetingId, agentId };
}

// --- Structured participant updates (SPEC-009 requirements: "structured
//     participant updates", acceptance #2: grounded in current tasks/artifacts) ---

export interface MeetingUpdate {
  id: string;
  meetingId: string;
  agentId: string;
  /** Deterministic summary assembled from the participant's tasks/artifacts. */
  content: string;
  /** Task ids the update is grounded in (the Agent's tasks in the Project). */
  taskIds: string[];
  /** Artifact ids the update is grounded in (the Agent's artifacts in the Project). */
  artifactIds: string[];
  createdAt: string;
}

export interface CreateMeetingUpdateInput {
  meetingId: string;
  agentId: string;
  content: string;
  taskIds: string[];
  artifactIds: string[];
}

export function validateMeetingUpdateContent(content: unknown): string {
  if (typeof content !== 'string') {
    throw new MeetingValidationError('update content must be a string');
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new MeetingValidationError('update content must not be empty');
  }
  if (trimmed.length > 20_000) {
    throw new MeetingValidationError('update content must be at most 20,000 characters');
  }
  return trimmed;
}

export function createMeetingUpdate(input: CreateMeetingUpdateInput): MeetingUpdate {
  return {
    id: randomUUID(),
    meetingId: input.meetingId,
    agentId: input.agentId,
    content: validateMeetingUpdateContent(input.content),
    taskIds: [...input.taskIds],
    artifactIds: [...input.artifactIds],
    createdAt: new Date().toISOString(),
  };
}

// --- Action items (SPEC-009: "action items", acceptance #4: they generate tasks) ---

export interface ActionItem {
  id: string;
  meetingId: string;
  projectId: string;
  title: string;
  /** Nullable: an action item may be an unassigned note for the PI. */
  assigneeAgentId: string | null;
  /** The follow-up Task generated from this item, set once (acceptance #4). */
  taskId: string | null;
  createdAt: string;
}

export interface CreateActionItemInput {
  meetingId: string;
  projectId: string;
  title: string;
  assigneeAgentId?: string | null;
}

export function validateActionItemTitle(title: unknown): string {
  if (typeof title !== 'string') {
    throw new MeetingValidationError('action item title must be a string');
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new MeetingValidationError('action item title must not be empty');
  }
  if (trimmed.length > 300) {
    throw new MeetingValidationError('action item title must be at most 300 characters');
  }
  return trimmed;
}

export function createActionItem(input: CreateActionItemInput): ActionItem {
  return {
    id: randomUUID(),
    meetingId: input.meetingId,
    projectId: input.projectId,
    title: validateActionItemTitle(input.title),
    assigneeAgentId: input.assigneeAgentId == null ? null : input.assigneeAgentId.trim(),
    taskId: null,
    createdAt: new Date().toISOString(),
  };
}

/** Records the follow-up Task generated from this action item (once). */
export function linkActionItemTask(item: ActionItem, taskId: string): ActionItem {
  if (taskId.trim().length === 0) {
    throw new MeetingValidationError('taskId must not be empty');
  }
  return { ...item, taskId };
}
