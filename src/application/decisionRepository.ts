import type { Decision } from '../domain/decision';

/**
 * Persistence boundary for Decisions (DOMAIN_MODEL, SPEC-009 acceptance #3).
 * Decisions are meeting-scoped in v0.1 but are a first-class entity of their own
 * per DOMAIN_MODEL, so they get their own repository.
 */
export interface DecisionRepository {
  insert(decision: Decision): void;
  findById(id: string): Decision | null;
  /** All decisions recorded in a Meeting, oldest first. */
  findByMeeting(meetingId: string): Decision[];
}
