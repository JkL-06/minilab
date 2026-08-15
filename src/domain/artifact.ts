import { randomUUID } from 'node:crypto';

import { ArtifactValidationError } from './errors';

/**
 * Persistent work product (SPEC-008, ADR-0004).
 *
 * An Artifact is durable research output that lives outside chat transcripts and run
 * results (AGENTS.md rule 10, acceptance #5). It belongs to exactly one Project
 * (DOMAIN_MODEL invariant #4) and may optionally link the Task and the Agent that
 * produced it. `type` is a free-form string in v0.1; the API preserves it along with
 * `version` (acceptance #4). Version lineage is expressed as sibling rows: a revision
 * carries the same project/task/creator with `version = parent.version + 1` and a
 * `sourceArtifactId` in metadata.
 *
 * The artifact's Lab is not stored directly: it is derived through the Project chain
 * (DOMAIN_MODEL lists no `lab_id` on Artifact).
 */
export const DEFAULT_ARTIFACT_TYPE = 'note';

export type ArtifactMetadata = Record<string, unknown>;

export interface Artifact {
  id: string;
  projectId: string;
  taskId: string | null;
  creatorAgentId: string | null;
  type: string;
  title: string;
  content: string;
  version: number;
  metadata: ArtifactMetadata | null;
  createdAt: string;
}

export interface CreateArtifactInput {
  projectId: string;
  taskId?: string | null;
  creatorAgentId?: string | null;
  type?: string;
  title: string;
  content: string;
  version?: number;
  metadata?: ArtifactMetadata | null;
}

export function validateArtifactType(type: unknown): string {
  if (typeof type !== 'string' || type.trim().length === 0) {
    throw new ArtifactValidationError('type must be a non-empty string');
  }
  const trimmed = type.trim();
  if (trimmed.length > 100) {
    throw new ArtifactValidationError('type must be at most 100 characters');
  }
  return trimmed;
}

export function validateArtifactTitle(title: unknown): string {
  if (typeof title !== 'string') {
    throw new ArtifactValidationError('title must be a string');
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new ArtifactValidationError('title must not be empty');
  }
  if (trimmed.length > 300) {
    throw new ArtifactValidationError('title must be at most 300 characters');
  }
  return trimmed;
}

export function validateArtifactContent(content: unknown): string {
  if (typeof content !== 'string') {
    throw new ArtifactValidationError('content must be a string');
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new ArtifactValidationError('content must not be empty');
  }
  if (trimmed.length > 100_000) {
    throw new ArtifactValidationError('content must be at most 100,000 characters');
  }
  return trimmed;
}

export function validateArtifactVersion(version: unknown): number {
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new ArtifactValidationError('version must be a positive integer');
  }
  return version;
}

/**
 * Creates a canonical artifact (version 1) with an immutable ID and a UTC timestamp.
 */
export function createArtifact(input: CreateArtifactInput): Artifact {
  return {
    id: randomUUID(),
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    creatorAgentId: input.creatorAgentId ?? null,
    type:
      input.type === undefined || input.type === null
        ? DEFAULT_ARTIFACT_TYPE
        : validateArtifactType(input.type),
    title: validateArtifactTitle(input.title),
    content: validateArtifactContent(input.content),
    version:
      input.version === undefined ? 1 : validateArtifactVersion(input.version),
    metadata: input.metadata ?? null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Creates the next version of an existing artifact. The revision keeps the parent's
 * project/task/creator linkage and type (title/type may be overridden), bumps
 * `version`, and records its lineage in metadata (`sourceArtifactId`). Sibling rows,
 * not a self-referencing table, are the lineage (ADR-0004).
 */
export function createArtifactRevision(
  parent: Artifact,
  input: { title?: string; type?: string; content: string; metadata?: ArtifactMetadata | null },
): Artifact {
  return createArtifact({
    projectId: parent.projectId,
    taskId: parent.taskId,
    creatorAgentId: parent.creatorAgentId,
    type: input.type === undefined ? parent.type : validateArtifactType(input.type),
    title: input.title === undefined ? parent.title : validateArtifactTitle(input.title),
    content: input.content,
    version: parent.version + 1,
    metadata: {
      ...(parent.metadata ?? {}),
      sourceArtifactId: parent.id,
      ...(input.metadata ?? {}),
    },
  });
}
