import type { ActionItem, Meeting, MeetingUpdate } from '../domain/meeting';
import {
  applyMeetingUpdate,
  createActionItem,
  createMeeting,
  createMeetingParticipant,
  createMeetingUpdate,
  linkActionItemTask,
  transitionMeetingStatus,
} from '../domain/meeting';
import type { Decision } from '../domain/decision';
import { createDecision } from '../domain/decision';
import {
  ActionItemNotFoundError,
  AgentNotFoundError,
  MeetingNotFoundError,
  MeetingValidationError,
  ProjectNotFoundError,
} from '../domain/errors';
import type { Artifact } from '../domain/artifact';
import type { Task } from '../domain/task';
import { assertLabOwnedBy } from './labAccess';
import type { AgentRepository } from './agentRepository';
import type { ArtifactRepository } from './artifactRepository';
import type { DecisionRepository } from './decisionRepository';
import type { LabRepository } from './labRepository';
import type { MeetingRepository } from './meetingRepository';
import type { MemoryService } from './memoryService';
import type { ProjectRepository } from './projectRepository';
import type { TaskRepository } from './taskRepository';
import type { TaskService } from './taskService';

export interface CreateMeetingParams {
  title: string;
  agenda?: string | null;
  participantAgentIds: string[];
}

export interface RecordDecisionParams {
  statement: string;
  rationale?: string | null;
}

export interface CreateActionItemParams {
  title: string;
  assigneeAgentId?: string | null;
}

/** The full structured outcome of a Meeting (acceptance #6). */
export interface MeetingDetail {
  meeting: Meeting;
  project: { id: string; title: string };
  participants: Array<{ agentId: string; name: string }>;
  updates: MeetingUpdate[];
  decisions: Decision[];
  actionItems: ActionItem[];
  /** Task ids generated from the Meeting's action items (acceptance #4). */
  resultingTaskIds: string[];
  /** Memory ids the completed Meeting wrote with `sourceType: 'meeting'` (acceptance #5). */
  memoryWriteIds: string[];
}

/**
 * Group Meetings (SPEC-009, ADR-0005): Alice, Bob, and the PI turn distributed
 * project work into decisions and follow-up tasks.
 *
 * The Meeting is PI-orchestrated and deterministic (rule 18): participant
 * updates are *assembled from the participants' persistent task/artifact rows at
 * creation* (acceptance #2) — no LLM call and no free-form input, so
 * "grounded in their current tasks/artifacts" is testable. Decisions are
 * PI-authored with server-set provenance (`madeByType: 'pi'`, `madeById` the
 * requester — acceptance #3). Action items can generate follow-up Tasks through
 * the TaskService (PI provenance, acceptance #4). Completion writes the outcome
 * to Project and Lab memory through the MemoryService with provenance
 * `sourceType: 'meeting'` (acceptance #5); a completed Meeting is immutable and
 * terminal, and the structured detail — not the transcript — is the record
 * (acceptance #6).
 */
export class MeetingService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly decisions: DecisionRepository,
    private readonly projects: ProjectRepository,
    private readonly labs: LabRepository,
    private readonly agents: AgentRepository,
    private readonly tasks: TaskRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly taskService: TaskService,
    private readonly memoryService: MemoryService,
  ) {}

  /**
   * `Prepare` + `Updates`: creates the Meeting (scheduled), adds its
   * participants, and generates each participant's structured update grounded in
   * their current tasks/artifacts in the Meeting's Project.
   */
  createMeeting(requesterUserId: string, projectId: string, params: CreateMeetingParams): Meeting {
    const project = this.requireProject(projectId);
    this.assertLabOwnedBy(requesterUserId, project.labId);
    if (params.participantAgentIds.length === 0) {
      throw new MeetingValidationError('a meeting needs at least one participant agent');
    }
    for (const agentId of params.participantAgentIds) {
      this.assertParticipantInLab(agentId, project.labId);
    }

    const meeting = createMeeting({
      labId: project.labId,
      projectId,
      title: params.title,
      agenda: params.agenda ?? null,
    });
    this.meetings.insertMeeting(meeting);

    for (const agentId of params.participantAgentIds) {
      this.meetings.insertParticipant(createMeetingParticipant(meeting.id, agentId));
    }
    for (const agentId of params.participantAgentIds) {
      this.meetings.insertUpdate(this.buildParticipantUpdate(meeting, agentId));
    }
    return meeting;
  }

  listProjectMeetings(requesterUserId: string, projectId: string): Meeting[] {
    const project = this.requireProject(projectId);
    this.assertLabOwnedBy(requesterUserId, project.labId);
    return this.meetings.findMeetingsByProject(projectId);
  }

  /** Full structured outcome of one Meeting (participants, updates, decisions, …). */
  getMeetingDetail(requesterUserId: string, meetingId: string): MeetingDetail {
    const meeting = this.requireMeeting(meetingId);
    this.assertLabOwnedBy(requesterUserId, meeting.labId);
    return this.assembleDetail(requesterUserId, meeting);
  }

  /** Edits the agenda / discussion transcript of a non-completed Meeting. */
  updateMeeting(
    requesterUserId: string,
    meetingId: string,
    patch: { agenda?: unknown; transcript?: unknown },
  ): Meeting {
    const meeting = this.requireMeeting(meetingId);
    this.assertLabOwnedBy(requesterUserId, meeting.labId);
    this.assertNotCompleted(meeting);
    const updated = applyMeetingUpdate(meeting, patch);
    this.meetings.updateMeeting(updated);
    return updated;
  }

  /** Begins the discussion: `scheduled → in_progress`, stamps `startedAt`. */
  startMeeting(requesterUserId: string, meetingId: string): Meeting {
    const meeting = this.requireMeeting(meetingId);
    this.assertLabOwnedBy(requesterUserId, meeting.labId);
    const started = transitionMeetingStatus(meeting, 'in_progress', new Date().toISOString());
    if (started !== meeting) {
      this.meetings.updateMeeting(started);
    }
    return started;
  }

  /** PI records a Decision in the Meeting (acceptance #3). Server-set provenance. */
  recordDecision(
    requesterUserId: string,
    meetingId: string,
    params: RecordDecisionParams,
  ): Decision {
    const meeting = this.requireMeeting(meetingId);
    this.assertLabOwnedBy(requesterUserId, meeting.labId);
    this.assertNotCompleted(meeting);
    const decision = createDecision({
      labId: meeting.labId,
      projectId: meeting.projectId,
      meetingId: meeting.id,
      madeByType: 'pi',
      madeById: requesterUserId,
      statement: params.statement,
      rationale: params.rationale,
    });
    this.decisions.insert(decision);
    return decision;
  }

  /** Records an Action Item; an assignee lets it generate a follow-up Task. */
  createActionItem(
    requesterUserId: string,
    meetingId: string,
    params: CreateActionItemParams,
  ): ActionItem {
    const meeting = this.requireMeeting(meetingId);
    this.assertLabOwnedBy(requesterUserId, meeting.labId);
    this.assertNotCompleted(meeting);
    if (params.assigneeAgentId) {
      this.assertParticipantInLab(params.assigneeAgentId, meeting.labId);
    }
    const item = createActionItem({
      meetingId: meeting.id,
      projectId: meeting.projectId,
      title: params.title,
      assigneeAgentId: params.assigneeAgentId ?? null,
    });
    this.meetings.insertActionItem(item);
    return item;
  }

  /**
   * Generates a follow-up Task in the Meeting's Project from an Action Item
   * (acceptance #4), assigned to the item's assignee, PI-authored. Idempotent: a
   * second call returns the already-created Task.
   */
  generateTaskFromActionItem(
    requesterUserId: string,
    meetingId: string,
    actionItemId: string,
  ): { task: Task; actionItem: ActionItem } {
    const meeting = this.requireMeeting(meetingId);
    this.assertLabOwnedBy(requesterUserId, meeting.labId);
    this.assertNotCompleted(meeting);
    const item = this.meetings.findActionItemById(actionItemId);
    if (!item || item.meetingId !== meeting.id) {
      throw new ActionItemNotFoundError(actionItemId);
    }
    if (item.taskId) {
      return { task: this.taskService.getTask(requesterUserId, item.taskId), actionItem: item };
    }
    if (!item.assigneeAgentId) {
      throw new MeetingValidationError(
        'an action item without an assignee cannot generate a follow-up task',
      );
    }
    const task = this.taskService.createTask(requesterUserId, meeting.projectId, {
      assigneeAgentId: item.assigneeAgentId,
      title: item.title,
    });
    const linked = linkActionItemTask(item, task.id);
    this.meetings.updateActionItem(linked);
    return { task, actionItem: linked };
  }

  /**
   * Completes the Meeting: `→ completed`, stamps `endedAt`, and writes the
   * outcome to Project- and Lab-scoped memory with provenance
   * `sourceType: 'meeting'` / `sourceId: <meeting id>` (acceptance #5). Returns
   * the full structured detail — memory write ids are recovered from the memory
   * rows' provenance, not denormalized. Idempotent: an already-completed Meeting
   * is returned without writing duplicate memory.
   */
  completeMeeting(requesterUserId: string, meetingId: string): MeetingDetail {
    const meeting = this.requireMeeting(meetingId);
    this.assertLabOwnedBy(requesterUserId, meeting.labId);
    if (meeting.status === 'completed') {
      return this.assembleDetail(requesterUserId, meeting);
    }

    const outcome = this.composeOutcomeSummary(meeting);
    this.memoryService.writeMemory(requesterUserId, meeting.labId, {
      scope: 'project',
      scopeId: meeting.projectId,
      memoryType: 'meeting',
      content: outcome,
      sourceType: 'meeting',
      sourceId: meeting.id,
    });
    this.memoryService.writeMemory(requesterUserId, meeting.labId, {
      scope: 'lab',
      memoryType: 'meeting',
      content: outcome,
      sourceType: 'meeting',
      sourceId: meeting.id,
    });

    const completed = transitionMeetingStatus(meeting, 'completed', new Date().toISOString());
    this.meetings.updateMeeting(completed);
    return this.assembleDetail(requesterUserId, completed);
  }

  private assembleDetail(requesterUserId: string, meeting: Meeting): MeetingDetail {
    const project = this.requireProject(meeting.projectId);
    const participants = this.meetings
      .findParticipants(meeting.id)
      .map((p) => ({ agentId: p.agentId, name: this.agents.findById(p.agentId)?.name ?? '?' }));
    const actionItems = this.meetings.findActionItems(meeting.id);
    return {
      meeting,
      project: { id: project.id, title: project.title },
      participants,
      updates: this.meetings.findUpdates(meeting.id),
      decisions: this.decisions.findByMeeting(meeting.id),
      actionItems,
      resultingTaskIds: actionItems.filter((item) => item.taskId).map((item) => item.taskId!),
      memoryWriteIds: this.memoryService
        .listMemoryBySource(requesterUserId, meeting.labId, 'meeting', meeting.id)
        .map((m) => m.id),
    };
  }

  /**
   * Deterministic participant update grounded in the Agent's current tasks and
   * artifacts in the Meeting's Project (acceptance #2).
   */
  private buildParticipantUpdate(meeting: Meeting, agentId: string): MeetingUpdate {
    const agentTasks = this.tasks
      .findByProject(meeting.projectId)
      .filter((task) => task.assigneeAgentId === agentId);
    const agentArtifacts = this.artifacts
      .findByProject(meeting.projectId)
      .filter((artifact) => artifact.creatorAgentId === agentId);
    return createMeetingUpdate({
      meetingId: meeting.id,
      agentId,
      content: composeUpdateContent(agentTasks, agentArtifacts),
      taskIds: agentTasks.map((task) => task.id),
      artifactIds: agentArtifacts.map((artifact) => artifact.id),
    });
  }

  /** One-line, deterministic outcome summary for the completion memory writes. */
  private composeOutcomeSummary(meeting: Meeting): string {
    const decisions = this.decisions.findByMeeting(meeting.id);
    const actionItems = this.meetings.findActionItems(meeting.id);
    const parts = [`Group meeting '${meeting.title}' outcome.`];
    if (decisions.length > 0) {
      parts.push(`Decisions: ${decisions.map((d) => d.statement).join('; ')}.`);
    }
    if (actionItems.length > 0) {
      parts.push(`Action items: ${actionItems.map((a) => a.title).join('; ')}.`);
    }
    const summary = parts.join('\n');
    // The memory content limit is 10,000 chars; keep the summary safely under it.
    return summary.length > 9_500 ? summary.slice(0, 9_500) : summary;
  }

  private requireMeeting(meetingId: string): Meeting {
    const meeting = this.meetings.findMeetingById(meetingId);
    if (!meeting) {
      throw new MeetingNotFoundError(meetingId);
    }
    return meeting;
  }

  private requireProject(projectId: string) {
    const project = this.projects.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }

  private assertLabOwnedBy(userId: string, labId: string): void {
    assertLabOwnedBy(this.labs, userId, labId);
  }

  private assertNotCompleted(meeting: Meeting): void {
    if (meeting.status === 'completed') {
      throw new MeetingValidationError('a completed meeting is immutable');
    }
  }

  /** Participants must be existing Agents in the same Lab as the Project. */
  private assertParticipantInLab(agentId: string, labId: string): void {
    const agent = this.agents.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }
    if (agent.labId !== labId) {
      throw new MeetingValidationError('participants must belong to the same Lab as the Project');
    }
  }
}

/** Shared by tests and the service: human-readable grounding summary. */
export function composeUpdateContent(tasks: Task[], artifacts: Artifact[]): string {
  const taskPart =
    tasks.length === 0
      ? 'no tasks in this project'
      : tasks.map((task) => `'${task.title}' (${task.status})`).join(', ');
  const artifactPart =
    artifacts.length === 0
      ? 'no artifacts in this project'
      : artifacts
          .map((artifact) => `'${artifact.title}' (${artifact.type}, v${artifact.version})`)
          .join(', ');
  return `Tasks: ${taskPart}. Artifacts: ${artifactPart}.`;
}
