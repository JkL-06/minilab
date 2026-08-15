import { randomUUID } from 'node:crypto';

import { MemoryValidationError } from './errors';

/**
 * Persistent scoped memory with provenance (SPEC-007, ADR-0003).
 *
 * Memory is a retrieval-oriented representation of relevant knowledge, not a
 * replacement for normalized source-of-truth entities (DOMAIN_MODEL.md): Task
 * status stays on Task, Project stage on Project. Every record carries full
 * provenance (source type, source id, author, creation time, scope, content) so
 * there are no orphan "AI remembered this somehow" entries (AGENTS.md rule 17).
 *
 * Scope selection follows the domain model: `scope_id` names the referenced
 * Agent/Project/Team and is `null` for the `lab` scope.
 */
export const MEMORY_SCOPES: ['agent', 'project', 'team', 'lab'] = [
  'agent',
  'project',
  'team',
  'lab',
];

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_AUTHOR_TYPES: ['pi', 'agent'] = ['pi', 'agent'];

export type MemoryAuthorType = (typeof MEMORY_AUTHOR_TYPES)[number];

export const DEFAULT_MEMORY_TYPE = 'note';
export const DEFAULT_MEMORY_IMPORTANCE = 3;

export interface Memory {
  id: string;
  labId: string;
  scope: MemoryScope;
  scopeId: string | null;
  memoryType: string;
  content: string;
  sourceType: string;
  sourceId: string;
  authorType: MemoryAuthorType;
  authorId: string;
  importance: number;
  createdAt: string;
}

export interface CreateMemoryInput {
  labId: string;
  scope: MemoryScope;
  scopeId?: string | null;
  memoryType?: string;
  content: string;
  sourceType: string;
  sourceId: string;
  authorType: MemoryAuthorType;
  authorId: string;
  importance?: number;
}

export function validateMemoryScope(scope: unknown): MemoryScope {
  if (!MEMORY_SCOPES.includes(scope as MemoryScope)) {
    throw new MemoryValidationError(`scope must be one of: ${MEMORY_SCOPES.join(', ')}`);
  }
  return scope as MemoryScope;
}

export function validateMemoryContent(content: unknown): string {
  if (typeof content !== 'string') {
    throw new MemoryValidationError('content must be a string');
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new MemoryValidationError('content must not be empty');
  }
  if (trimmed.length > 10_000) {
    throw new MemoryValidationError('content must be at most 10,000 characters');
  }
  return trimmed;
}

export function validateMemoryType(memoryType: unknown): string {
  if (typeof memoryType !== 'string' || memoryType.trim().length === 0) {
    throw new MemoryValidationError('memoryType must be a non-empty string');
  }
  const trimmed = memoryType.trim();
  if (trimmed.length > 100) {
    throw new MemoryValidationError('memoryType must be at most 100 characters');
  }
  return trimmed;
}

export function validateSourceType(sourceType: unknown): string {
  if (typeof sourceType !== 'string' || sourceType.trim().length === 0) {
    throw new MemoryValidationError('sourceType must be a non-empty string');
  }
  const trimmed = sourceType.trim();
  if (trimmed.length > 100) {
    throw new MemoryValidationError('sourceType must be at most 100 characters');
  }
  return trimmed;
}

export function validateSourceId(sourceId: unknown): string {
  if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
    throw new MemoryValidationError('sourceId must be a non-empty string');
  }
  const trimmed = sourceId.trim();
  if (trimmed.length > 200) {
    throw new MemoryValidationError('sourceId must be at most 200 characters');
  }
  return trimmed;
}

export function validateMemoryImportance(importance: unknown): number {
  if (
    typeof importance !== 'number' ||
    !Number.isInteger(importance) ||
    importance < 1 ||
    importance > 5
  ) {
    throw new MemoryValidationError('importance must be an integer between 1 and 5');
  }
  return importance;
}

/**
 * A `scope_id` names the referenced Agent/Project/Team and must be present for
 * those scopes; the `lab` scope is the whole Lab and has no id.
 */
export function validateScopeIdForScope(scope: MemoryScope, scopeId: unknown): string | null {
  if (scope === 'lab') {
    if (scopeId != null) {
      throw new MemoryValidationError('lab-scoped memory must not carry a scopeId');
    }
    return null;
  }
  if (typeof scopeId !== 'string' || scopeId.trim().length === 0) {
    throw new MemoryValidationError(`scopeId is required for ${scope}-scoped memory`);
  }
  return scopeId.trim();
}

/**
 * Creates a canonical memory record with an immutable ID, a validated scope,
 * server-side provenance, and UTC timestamps.
 */
export function createMemory(input: CreateMemoryInput): Memory {
  const scope = validateMemoryScope(input.scope);
  const scopeId = validateScopeIdForScope(scope, input.scopeId ?? null);
  return {
    id: randomUUID(),
    labId: input.labId,
    scope,
    scopeId,
    memoryType:
      input.memoryType === undefined || input.memoryType === null
        ? DEFAULT_MEMORY_TYPE
        : validateMemoryType(input.memoryType),
    content: validateMemoryContent(input.content),
    sourceType: validateSourceType(input.sourceType),
    sourceId: validateSourceId(input.sourceId),
    authorType: input.authorType,
    authorId: input.authorId,
    importance:
      input.importance === undefined ? DEFAULT_MEMORY_IMPORTANCE : validateMemoryImportance(input.importance),
    createdAt: new Date().toISOString(),
  };
}
