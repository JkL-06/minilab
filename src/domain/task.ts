import { randomUUID } from 'node:crypto';

import { TaskValidationError } from './errors';

/**
 * Task is an atomic unit of delegated work (SPEC-004).
 *
 * A Task belongs to exactly one Project (DOMAIN_MODEL invariant #3), which in
 * turn belongs to exactly one Lab — so a Task transitively lives in one Lab.
 * MVP supports a single assignee: the task is always bound to exactly one
 * Agent in the same Lab as its Project. The creator is recorded with a type +
 * id so both PI-created and (later) agent-proposed tasks carry provenance.
 *
 * Status is a deterministic state machine: invalid transitions are rejected by
 * the domain (SPEC-004 acceptance #4). Self-transitions are allowed so retries
 * stay idempotent; `completed`/`cancelled` are terminal.
 */
export const TASK_STATUSES: [
  'backlog',
  'ready',
  'running',
  'blocked',
  'review',
  'completed',
  'cancelled',
] = ['backlog', 'ready', 'running', 'blocked', 'review', 'completed', 'cancelled'];

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Allowed next statuses per current status (includes the identity transition). */
export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ['backlog', 'ready', 'cancelled'],
  ready: ['ready', 'backlog', 'running', 'cancelled'],
  running: ['running', 'blocked', 'review', 'completed', 'cancelled'],
  blocked: ['blocked', 'running', 'cancelled'],
  review: ['review', 'running', 'completed', 'cancelled'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

export const TASK_PRIORITIES: ['low', 'medium', 'high', 'urgent'] = [
  'low',
  'medium',
  'high',
  'urgent',
];

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Who created the task. `agent` covers future agent-proposed follow-ups. */
export const TASK_CREATOR_TYPES: ['pi', 'agent'] = ['pi', 'agent'];

export type TaskCreatorType = (typeof TASK_CREATOR_TYPES)[number];

export const DEFAULT_TASK_STATUS: TaskStatus = 'backlog';
export const DEFAULT_TASK_PRIORITY: TaskPriority = 'medium';

export interface Task {
  id: string;
  projectId: string;
  creatorType: TaskCreatorType;
  creatorId: string;
  assigneeAgentId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  projectId: string;
  creatorType: TaskCreatorType;
  creatorId: string;
  assigneeAgentId: string;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
}

export interface TaskUpdatePatch {
  title?: unknown;
  description?: unknown;
  assigneeAgentId?: unknown;
  status?: unknown;
  priority?: unknown;
  dueAt?: unknown;
}

export function validateTaskTitle(title: unknown): string {
  if (typeof title !== 'string') {
    throw new TaskValidationError('title must be a string');
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new TaskValidationError('title must not be empty');
  }
  return trimmed;
}

export function validateTaskStatus(status: unknown): TaskStatus {
  if (!TASK_STATUSES.includes(status as TaskStatus)) {
    throw new TaskValidationError(`status must be one of: ${TASK_STATUSES.join(', ')}`);
  }
  return status as TaskStatus;
}

export function validateTaskPriority(priority: unknown): TaskPriority {
  if (!TASK_PRIORITIES.includes(priority as TaskPriority)) {
    throw new TaskValidationError(`priority must be one of: ${TASK_PRIORITIES.join(', ')}`);
  }
  return priority as TaskPriority;
}

export function validateTaskCreatorType(creatorType: unknown): TaskCreatorType {
  if (creatorType !== 'pi' && creatorType !== 'agent') {
    throw new TaskValidationError("creatorType must be 'pi' or 'agent'");
  }
  return creatorType;
}

/** The assignee is a single Agent reference; the same-Lab check lives in the service. */
export function validateAssigneeAgentId(agentId: unknown): string {
  if (typeof agentId !== 'string' || agentId.trim().length === 0) {
    throw new TaskValidationError('assigneeAgentId must be a non-empty string reference');
  }
  return agentId.trim();
}

/** A due date is an optional ISO-8601 UTC timestamp; `null` clears it. */
export function validateDueAt(dueAt: unknown): string {
  if (typeof dueAt !== 'string' || Number.isNaN(Date.parse(dueAt))) {
    throw new TaskValidationError('dueAt must be a valid ISO-8601 timestamp');
  }
  return dueAt;
}

export function assertStatusTransition(current: TaskStatus, next: TaskStatus): void {
  if (!TASK_STATUS_TRANSITIONS[current].includes(next)) {
    throw new TaskValidationError(
      `invalid status transition: ${current} → ${next}`,
    );
  }
}

/**
 * Creates a new Task in a Project with a single assignee (MVP), server-side
 * creator provenance, and UTC timestamps. New tasks start in the backlog.
 */
export function createTask(input: CreateTaskInput): Task {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    projectId: input.projectId,
    creatorType: validateTaskCreatorType(input.creatorType),
    creatorId: input.creatorId,
    assigneeAgentId: validateAssigneeAgentId(input.assigneeAgentId),
    title: validateTaskTitle(input.title),
    description: input.description ?? null,
    status: DEFAULT_TASK_STATUS,
    priority: input.priority === undefined ? DEFAULT_TASK_PRIORITY : validateTaskPriority(input.priority),
    dueAt: input.dueAt == null ? null : validateDueAt(input.dueAt),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Applies a partial update to a Task. Status changes must follow the state
 * machine (SPEC-004 #4); completing/cancelling changes state in place without
 * deleting prior history (SPEC-004 #5). `updatedAt` is always bumped.
 */
export function applyTaskUpdate(task: Task, patch: TaskUpdatePatch): Task {
  const next: Task = { ...task };
  if ('title' in patch) {
    next.title = validateTaskTitle(patch.title);
  }
  if ('description' in patch) {
    next.description = patch.description == null ? null : String(patch.description);
  }
  if ('assigneeAgentId' in patch) {
    next.assigneeAgentId = validateAssigneeAgentId(patch.assigneeAgentId);
  }
  if ('status' in patch) {
    const nextStatus = validateTaskStatus(patch.status);
    assertStatusTransition(next.status, nextStatus);
    next.status = nextStatus;
  }
  if ('priority' in patch) {
    next.priority = validateTaskPriority(patch.priority);
  }
  if ('dueAt' in patch) {
    next.dueAt = patch.dueAt == null ? null : validateDueAt(patch.dueAt);
  }
  next.updatedAt = new Date().toISOString();
  return next;
}
