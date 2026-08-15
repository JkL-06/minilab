import { randomUUID } from 'node:crypto';

import { ProjectValidationError } from './errors';

/**
 * Project is a long-running research initiative inside a Lab (SPEC-003).
 *
 * Per DOMAIN_MODEL.md a Project is the unit of orchestration work: it belongs to
 * exactly one Lab (invariant #1), may optionally reference a Team (v0.1 ships a
 * single implicit team, so `teamId` is a nullable reference with no table yet),
 * and carries an immutable `id` plus UTC timestamps. The research stage is a
 * closed enum — it is context for orchestration/UX and never decides direction
 * autonomously.
 */
export const RESEARCH_STAGES: [
  'explore',
  'survey',
  'ideate',
  'validate',
  'develop',
  'analyze',
  'write',
  'submit',
  'revise',
] = ['explore', 'survey', 'ideate', 'validate', 'develop', 'analyze', 'write', 'submit', 'revise'];

export type ResearchStage = (typeof RESEARCH_STAGES)[number];

export const PROJECT_STATUSES: [
  'planned',
  'active',
  'blocked',
  'paused',
  'completed',
  'archived',
] = ['planned', 'active', 'blocked', 'paused', 'completed', 'archived'];

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const DEFAULT_PROJECT_STAGE: ResearchStage = 'explore';
export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'planned';

export interface Project {
  id: string;
  labId: string;
  teamId: string | null;
  title: string;
  objective: string | null;
  stage: ResearchStage;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  labId: string;
  title: string;
  objective?: string | null;
  teamId?: string | null;
  stage?: ResearchStage;
  status?: ProjectStatus;
}

export interface ProjectUpdatePatch {
  title?: unknown;
  objective?: unknown;
  teamId?: unknown;
  stage?: unknown;
  status?: unknown;
}

export function validateProjectTitle(title: unknown): string {
  if (typeof title !== 'string') {
    throw new ProjectValidationError('title must be a string');
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new ProjectValidationError('title must not be empty');
  }
  return trimmed;
}

export function validateResearchStage(stage: unknown): ResearchStage {
  if (!RESEARCH_STAGES.includes(stage as ResearchStage)) {
    throw new ProjectValidationError(
      `stage must be one of: ${RESEARCH_STAGES.join(', ')}`,
    );
  }
  return stage as ResearchStage;
}

export function validateProjectStatus(status: unknown): ProjectStatus {
  if (!PROJECT_STATUSES.includes(status as ProjectStatus)) {
    throw new ProjectValidationError(
      `status must be one of: ${PROJECT_STATUSES.join(', ')}`,
    );
  }
  return status as ProjectStatus;
}

/** A team reference is an ID (nullable in v0.1's single-team model), never an object. */
export function validateTeamId(teamId: unknown): string {
  if (typeof teamId !== 'string' || teamId.trim().length === 0) {
    throw new ProjectValidationError('teamId must be a non-empty string reference');
  }
  return teamId.trim();
}

/**
 * Creates a new Project with an immutable ID, exactly one Lab, an optional team
 * reference, a validated research stage, and UTC timestamps.
 */
export function createProject(input: CreateProjectInput): Project {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    labId: input.labId,
    teamId: input.teamId == null ? null : validateTeamId(input.teamId),
    title: validateProjectTitle(input.title),
    objective: input.objective ?? null,
    stage: input.stage === undefined ? DEFAULT_PROJECT_STAGE : validateResearchStage(input.stage),
    status: input.status === undefined ? DEFAULT_PROJECT_STATUS : validateProjectStatus(input.status),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Applies a partial update to a Project. Only supplied fields change;
 * `objective`/`teamId` set to `null` clears them. `updatedAt` is always bumped
 * so any change (including an objective change, SPEC-003 acceptance #4) is
 * recorded with a fresh update timestamp.
 */
export function applyProjectUpdate(project: Project, patch: ProjectUpdatePatch): Project {
  const next: Project = { ...project };
  if ('title' in patch) {
    next.title = validateProjectTitle(patch.title);
  }
  if ('objective' in patch) {
    next.objective = patch.objective == null ? null : String(patch.objective);
  }
  if ('teamId' in patch) {
    next.teamId = patch.teamId == null ? null : validateTeamId(patch.teamId);
  }
  if ('stage' in patch) {
    next.stage = validateResearchStage(patch.stage);
  }
  if ('status' in patch) {
    next.status = validateProjectStatus(patch.status);
  }
  next.updatedAt = new Date().toISOString();
  return next;
}
