import type { DecisionRepository } from '../../src/application/decisionRepository';
import type { Decision } from '../../src/domain/decision';

/**
 * In-memory DecisionRepository for service/API tests. Not used by the
 * persistence and restart tests, which exercise the real SQLite repository.
 */
export function inMemoryDecisionRepository(): DecisionRepository & { decisions: Decision[] } {
  const decisions: Decision[] = [];
  return {
    decisions,
    insert(decision: Decision): void {
      decisions.push(decision);
    },
    findById(id: string): Decision | null {
      return decisions.find((decision) => decision.id === id) ?? null;
    },
    findByMeeting(meetingId: string): Decision[] {
      return decisions.filter((decision) => decision.meetingId === meetingId);
    },
  };
}
