import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTaskUpdate,
  assertStatusTransition,
  createTask,
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  TASK_PRIORITIES,
  TASK_STATUS_TRANSITIONS,
  TASK_STATUSES,
  validateTaskCreatorType,
  type CreateTaskInput,
} from '../../src/domain/task';
import { TaskValidationError } from '../../src/domain/errors';

function baseInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    projectId: 'project-1',
    creatorType: 'pi',
    creatorId: 'user-1',
    assigneeAgentId: 'agent-1',
    title: 'Survey the literature',
    ...overrides,
  };
}

test('createTask stores the full shape with defaults and server-set creator', () => {
  const task = createTask(baseInput());

  assert.ok(task.id, 'immutable UUIDv4 id');
  assert.equal(task.projectId, 'project-1');
  assert.equal(task.creatorType, 'pi');
  assert.equal(task.creatorId, 'user-1');
  assert.equal(task.assigneeAgentId, 'agent-1');
  assert.equal(task.title, 'Survey the literature');
  assert.equal(task.description, null);
  assert.equal(task.status, DEFAULT_TASK_STATUS);
  assert.equal(task.priority, DEFAULT_TASK_PRIORITY);
  assert.equal(task.dueAt, null);
  assert.match(task.createdAt, /Z$/);
  assert.equal(task.updatedAt, task.createdAt);
});

test('createTask accepts description, priority, and due date', () => {
  const task = createTask(
    baseInput({
      description: 'Map the evidence base.',
      priority: 'urgent',
      dueAt: '2026-09-01T00:00:00.000Z',
    }),
  );

  assert.equal(task.description, 'Map the evidence base.');
  assert.equal(task.priority, 'urgent');
  assert.equal(task.dueAt, '2026-09-01T00:00:00.000Z');
});

test('createTask rejects an empty title and an empty assignee', () => {
  assert.throws(() => createTask(baseInput({ title: '   ' })), TaskValidationError);
  assert.throws(() => createTask(baseInput({ assigneeAgentId: '' })), TaskValidationError);
});

test('createTask rejects an invalid priority and an invalid due date', () => {
  assert.throws(
    () =>
      createTask(
        baseInput({ priority: 'critical' } as unknown as Partial<CreateTaskInput>),
      ),
    TaskValidationError,
  );
  assert.throws(
    () =>
      createTask(
        baseInput({ dueAt: 'not-a-date' } as unknown as Partial<CreateTaskInput>),
      ),
    TaskValidationError,
  );
});

test('validateTaskCreatorType accepts pi and agent only', () => {
  assert.equal(validateTaskCreatorType('pi'), 'pi');
  assert.equal(validateTaskCreatorType('agent'), 'agent');
  assert.throws(() => validateTaskCreatorType('system'), TaskValidationError);
});

test('TASK_STATUSES enumerates the seven supported statuses', () => {
  assert.deepEqual(TASK_STATUSES, [
    'backlog',
    'ready',
    'running',
    'blocked',
    'review',
    'completed',
    'cancelled',
  ]);
});

test('TASK_PRIORITIES enumerates the four supported priorities', () => {
  assert.deepEqual(TASK_PRIORITIES, ['low', 'medium', 'high', 'urgent']);
});

test('assertStatusTransition accepts legal moves and rejects illegal ones (SPEC-004 #4)', () => {
  assert.doesNotThrow(() => assertStatusTransition('backlog', 'ready'));
  assert.doesNotThrow(() => assertStatusTransition('ready', 'running'));
  assert.doesNotThrow(() => assertStatusTransition('running', 'blocked'));
  assert.doesNotThrow(() => assertStatusTransition('blocked', 'running'));
  assert.doesNotThrow(() => assertStatusTransition('running', 'review'));
  assert.doesNotThrow(() => assertStatusTransition('review', 'completed'));
  assert.doesNotThrow(() => assertStatusTransition('running', 'completed'));

  assert.throws(() => assertStatusTransition('backlog', 'running'), TaskValidationError);
  assert.throws(() => assertStatusTransition('ready', 'completed'), TaskValidationError);
  assert.throws(() => assertStatusTransition('completed', 'running'), TaskValidationError);
  assert.throws(() => assertStatusTransition('cancelled', 'running'), TaskValidationError);
});

test('the transition table includes the identity transition for idempotent retries', () => {
  for (const status of TASK_STATUSES) {
    assert.ok(
      TASK_STATUS_TRANSITIONS[status].includes(status),
      `${status} must transition to itself`,
    );
  }
});

test('applyTaskUpdate changes only supplied fields and bumps updatedAt', () => {
  const before = createTask(baseInput());
  const updated = applyTaskUpdate(before, { priority: 'high', dueAt: null });

  assert.equal(updated.priority, 'high');
  assert.equal(updated.dueAt, null);
  assert.equal(updated.title, before.title, 'unsupplied fields are untouched');
  assert.equal(updated.assigneeAgentId, before.assigneeAgentId);
  assert.equal(updated.status, before.status);
  assert.ok(
    Date.parse(updated.updatedAt) >= Date.parse(before.updatedAt),
    'updatedAt must never go backwards',
  );
});

test('applyTaskUpdate rejects an invalid status transition (SPEC-004 #4)', () => {
  const task = createTask(baseInput());
  assert.throws(() => applyTaskUpdate(task, { status: 'running' }), TaskValidationError);
});

test('completing a task keeps its prior history in place (SPEC-004 #5)', () => {
  const task = createTask(
    baseInput({ description: 'Map the evidence base.', priority: 'high' }),
  );
  // Walk a valid chain to completion (backlog → ready → running → review → completed).
  const ready = applyTaskUpdate(task, { status: 'ready' });
  const running = applyTaskUpdate(ready, { status: 'running' });
  const review = applyTaskUpdate(running, { status: 'review' });
  const completed = applyTaskUpdate(review, { status: 'completed' });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.id, task.id, 'same immutable id — nothing deleted');
  assert.equal(completed.title, task.title, 'title retained');
  assert.equal(completed.assigneeAgentId, task.assigneeAgentId, 'assignment retained');
  assert.equal(completed.description, task.description, 'description retained');
  assert.equal(completed.priority, task.priority, 'priority retained');
  assert.equal(completed.projectId, task.projectId, 'project association retained');
});
