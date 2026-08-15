import type { Decision, DecisionMakerType } from '../../domain/decision';
import type { DecisionRepository } from '../../application/decisionRepository';
import type { MiniLabDb } from './database';

interface DecisionRow {
  id: string;
  lab_id: string;
  project_id: string | null;
  meeting_id: string | null;
  made_by_type: string;
  made_by_id: string;
  statement: string;
  rationale: string | null;
  created_at: string;
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    meetingId: row.meeting_id,
    madeByType: row.made_by_type as DecisionMakerType,
    madeById: row.made_by_id,
    statement: row.statement,
    rationale: row.rationale,
    createdAt: row.created_at,
  };
}

function toRow(decision: Decision): DecisionRow {
  return {
    id: decision.id,
    lab_id: decision.labId,
    project_id: decision.projectId,
    meeting_id: decision.meetingId,
    made_by_type: decision.madeByType,
    made_by_id: decision.madeById,
    statement: decision.statement,
    rationale: decision.rationale,
    created_at: decision.createdAt,
  };
}

/**
 * SQLite-backed DecisionRepository (DOMAIN_MODEL, SPEC-009 acceptance #3).
 * Decisions are recorded by the PI against a Meeting in v0.1.
 */
export class SqliteDecisionRepository implements DecisionRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(decision: Decision): void {
    this.db
      .prepare(
        `INSERT INTO decisions
           (id, lab_id, project_id, meeting_id, made_by_type, made_by_id,
            statement, rationale, created_at)
         VALUES
           (@id, @lab_id, @project_id, @meeting_id, @made_by_type, @made_by_id,
            @statement, @rationale, @created_at)`,
      )
      .run(toRow(decision));
  }

  findById(id: string): Decision | null {
    const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
      | DecisionRow
      | undefined;
    return row ? toDecision(row) : null;
  }

  findByMeeting(meetingId: string): Decision[] {
    const rows = this.db
      .prepare('SELECT * FROM decisions WHERE meeting_id = ? ORDER BY created_at')
      .all(meetingId) as DecisionRow[];
    return rows.map(toDecision);
  }
}
