import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMemory,
  DEFAULT_MEMORY_IMPORTANCE,
  DEFAULT_MEMORY_TYPE,
  MEMORY_AUTHOR_TYPES,
  MEMORY_SCOPES,
  validateMemoryContent,
  validateMemoryImportance,
  validateMemoryScope,
  validateScopeIdForScope,
  type CreateMemoryInput,
} from '../../src/domain/memory';
import { MemoryValidationError } from '../../src/domain/errors';

function baseInput(overrides: Partial<CreateMemoryInput> = {}): CreateMemoryInput {
  return {
    labId: 'lab-1',
    scope: 'agent',
    scopeId: 'agent-1',
    content: 'Alice prefers structured survey notes.',
    sourceType: 'interview',
    sourceId: 'interview-2026-08',
    authorType: 'pi',
    authorId: 'user-1',
    ...overrides,
  };
}

test('createMemory stores the full provenance shape with defaults', () => {
  const memory = createMemory(baseInput());

  assert.ok(memory.id, 'immutable UUIDv4 id');
  assert.equal(memory.labId, 'lab-1');
  assert.equal(memory.scope, 'agent');
  assert.equal(memory.scopeId, 'agent-1');
  assert.equal(memory.memoryType, DEFAULT_MEMORY_TYPE);
  assert.equal(memory.content, 'Alice prefers structured survey notes.');
  assert.equal(memory.sourceType, 'interview');
  assert.equal(memory.sourceId, 'interview-2026-08');
  assert.equal(memory.authorType, 'pi');
  assert.equal(memory.authorId, 'user-1');
  assert.equal(memory.importance, DEFAULT_MEMORY_IMPORTANCE);
  assert.match(memory.createdAt, /Z$/, 'UTC ISO-8601 timestamp');
});

test('createMemory accepts an explicit memoryType and importance', () => {
  const memory = createMemory(
    baseInput({ memoryType: 'hypothesis', importance: 5, content: '  Double-check the effect.  ' }),
  );

  assert.equal(memory.memoryType, 'hypothesis');
  assert.equal(memory.importance, 5);
  assert.equal(memory.content, 'Double-check the effect.', 'content is trimmed');
});

test('createMemory rejects an empty content and an invalid scope', () => {
  assert.throws(() => createMemory(baseInput({ content: '   ' })), MemoryValidationError);
  assert.throws(
    () => createMemory(baseInput({ scope: 'system' as never })),
    MemoryValidationError,
  );
});

test('createMemory rejects an out-of-range importance and an over-long type', () => {
  assert.throws(() => createMemory(baseInput({ importance: 0 })), MemoryValidationError);
  assert.throws(() => createMemory(baseInput({ importance: 6 })), MemoryValidationError);
  assert.throws(
    () => createMemory(baseInput({ memoryType: 'x'.repeat(101) })),
    MemoryValidationError,
  );
});

test('validateScopeIdForScope enforces the lab/others split', () => {
  assert.equal(validateScopeIdForScope('lab', null), null);
  assert.equal(validateScopeIdForScope('lab', undefined), null);
  assert.throws(() => validateScopeIdForScope('lab', 'team-1'), MemoryValidationError);

  assert.equal(validateScopeIdForScope('agent', 'agent-1'), 'agent-1');
  assert.equal(validateScopeIdForScope('project', 'project-1'), 'project-1');
  assert.equal(validateScopeIdForScope('team', 'team-1'), 'team-1');
  assert.throws(() => validateScopeIdForScope('agent', ''), MemoryValidationError);
  assert.throws(() => validateScopeIdForScope('project', '  '), MemoryValidationError);
});

test('createMemory rejects a lab-scoped memory carrying a scopeId', () => {
  assert.throws(
    () => createMemory(baseInput({ scope: 'lab', scopeId: 'team-1' })),
    MemoryValidationError,
  );
});

test('MEMORY_SCOPES enumerates agent, project, team, lab; authors are pi and agent', () => {
  assert.deepEqual(MEMORY_SCOPES, ['agent', 'project', 'team', 'lab']);
  assert.deepEqual(MEMORY_AUTHOR_TYPES, ['pi', 'agent']);
  assert.doesNotThrow(() => validateMemoryScope('lab'));
  assert.throws(() => validateMemoryScope('system'), MemoryValidationError);
});

test('validateMemoryImportance accepts only integers from 1 to 5', () => {
  assert.equal(validateMemoryImportance(3), 3);
  assert.throws(() => validateMemoryImportance(2.5), MemoryValidationError);
  assert.throws(() => validateMemoryImportance(-1), MemoryValidationError);
});

test('validateMemoryContent rejects content over 10,000 characters', () => {
  assert.throws(() => validateMemoryContent('x'.repeat(10_001)), MemoryValidationError);
});
