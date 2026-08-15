import { randomUUID } from 'node:crypto';

import { LabValidationError } from './errors';

/**
 * Lab is the top-level persistent research organization (SPEC-001).
 *
 * Per DOMAIN_MODEL.md every Lab has an owner, a name, an optional description,
 * and UTC timestamps. IDs are immutable UUIDs.
 */
export interface Lab {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLabInput {
  ownerUserId: string;
  name: string;
  description?: string | null;
}

/** Validates and normalizes a Lab name. Empty (or whitespace-only) names are rejected. */
export function validateLabName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new LabValidationError('name must be a string');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new LabValidationError('name must not be empty');
  }
  return trimmed;
}

/** Creates a new Lab with an immutable ID and UTC timestamps. */
export function createLab(input: CreateLabInput): Lab {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ownerUserId: input.ownerUserId,
    name: validateLabName(input.name),
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface LabUpdatePatch {
  name?: unknown;
  description?: unknown;
}

/**
 * Applies a partial update to a Lab.
 * Only supplied fields are changed; `description` may be set to `null` to clear it.
 * `updatedAt` is always bumped.
 */
export function applyLabUpdate(lab: Lab, patch: LabUpdatePatch): Lab {
  const next: Lab = { ...lab };
  if ('name' in patch) {
    next.name = validateLabName(patch.name);
  }
  if ('description' in patch) {
    next.description = patch.description == null ? null : String(patch.description);
  }
  next.updatedAt = new Date().toISOString();
  return next;
}
