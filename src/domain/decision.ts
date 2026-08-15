import { randomUUID } from 'node:crypto';

import { DecisionValidationError } from './errors';

/**
 * Decision (DOMAIN_MODEL, SPEC-009 acceptance #3).
 *
 * A structured research/organizational decision, usually produced by PI
 * interaction or a meeting. `made_by_type`/`made_by_id` record *who* decided —
 * in SPEC-009 the PI records decisions during a Meeting, so `madeByType` is
 * `pi` and `madeById` is the requesting user (server-set; clients cannot forge
 * it). The decision links to its Meeting (`meetingId`) and to the Meeting's
 * Project (`projectId`); both are nullable in the domain per DOMAIN_MODEL to
 * leave room for standalone decisions later, but the SPEC-009 service always
 * populates both.
 */
export const DECISION_MAKER_TYPES: ['pi', 'agent'] = ['pi', 'agent'];

export type DecisionMakerType = (typeof DECISION_MAKER_TYPES)[number];

export interface Decision {
  id: string;
  labId: string;
  projectId: string | null;
  meetingId: string | null;
  madeByType: DecisionMakerType;
  madeById: string;
  statement: string;
  rationale: string | null;
  createdAt: string;
}

export interface CreateDecisionInput {
  labId: string;
  projectId?: string | null;
  meetingId?: string | null;
  madeByType: DecisionMakerType;
  madeById: string;
  statement: string;
  rationale?: string | null;
}

export function validateDecisionStatement(statement: unknown): string {
  if (typeof statement !== 'string') {
    throw new DecisionValidationError('statement must be a string');
  }
  const trimmed = statement.trim();
  if (trimmed.length === 0) {
    throw new DecisionValidationError('statement must not be empty');
  }
  if (trimmed.length > 5_000) {
    throw new DecisionValidationError('statement must be at most 5,000 characters');
  }
  return trimmed;
}

export function validateDecisionRationale(rationale: unknown): string {
  if (typeof rationale !== 'string') {
    throw new DecisionValidationError('rationale must be a string');
  }
  const trimmed = rationale.trim();
  if (trimmed.length > 5_000) {
    throw new DecisionValidationError('rationale must be at most 5,000 characters');
  }
  return trimmed;
}

/** Creates a Decision with server-side provenance and a UTC timestamp. */
export function createDecision(input: CreateDecisionInput): Decision {
  return {
    id: randomUUID(),
    labId: input.labId,
    projectId: input.projectId ?? null,
    meetingId: input.meetingId ?? null,
    madeByType: input.madeByType,
    madeById: input.madeById,
    statement: validateDecisionStatement(input.statement),
    rationale: input.rationale == null ? null : validateDecisionRationale(input.rationale),
    createdAt: new Date().toISOString(),
  };
}
