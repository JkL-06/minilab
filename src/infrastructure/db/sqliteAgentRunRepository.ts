import type {
  AgentRun,
  AgentRunFailureCategory,
  AgentRunOutcomeStatus,
} from '../../domain/agentRun';
import type { ModelProvider } from '../../domain/modelConfig';
import type { AgentRunRepository } from '../../application/agentRunRepository';
import type { MiniLabDb } from './database';

interface AgentRunRow {
  id: string;
  lab_id: string;
  agent_id: string;
  project_id: string;
  task_id: string;
  model_config_id: string | null;
  provider: string | null;
  model: string | null;
  status: string;
  error_category: string | null;
  result_schema_version: number | null;
  result: string | null;
  started_at: string;
  ended_at: string;
  created_at: string;
}

function toRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    labId: row.lab_id,
    agentId: row.agent_id,
    projectId: row.project_id,
    taskId: row.task_id,
    modelConfigId: row.model_config_id,
    provider: row.provider as ModelProvider | null,
    model: row.model,
    status: row.status as AgentRunOutcomeStatus,
    errorCategory: row.error_category as AgentRunFailureCategory | null,
    resultSchemaVersion: row.result_schema_version,
    result: row.result == null ? null : (JSON.parse(row.result) as AgentRun['result']),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

function toRow(run: AgentRun): AgentRunRow {
  return {
    id: run.id,
    lab_id: run.labId,
    agent_id: run.agentId,
    project_id: run.projectId,
    task_id: run.taskId,
    model_config_id: run.modelConfigId,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error_category: run.errorCategory,
    result_schema_version: run.resultSchemaVersion,
    result: run.result == null ? null : JSON.stringify(run.result),
    started_at: run.startedAt,
    ended_at: run.endedAt,
    created_at: run.createdAt,
  };
}

/** SQLite-backed AgentRunRepository. Maps snake_case rows to camelCase domain objects. */
export class SqliteAgentRunRepository implements AgentRunRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(run: AgentRun): void {
    const row = toRow(run);
    this.db
      .prepare(
        `INSERT INTO agent_runs
           (id, lab_id, agent_id, project_id, task_id, model_config_id, provider, model,
            status, error_category, result_schema_version, result,
            started_at, ended_at, created_at)
         VALUES
           (@id, @lab_id, @agent_id, @project_id, @task_id, @model_config_id, @provider, @model,
            @status, @error_category, @result_schema_version, @result,
            @started_at, @ended_at, @created_at)`,
      )
      .run(row);
  }

  findById(id: string): AgentRun | null {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | undefined;
    return row ? toRun(row) : null;
  }

  /** Newest first — a run log reads naturally from latest attempt. */
  findByAgent(agentId: string): AgentRun[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY created_at DESC')
      .all(agentId) as AgentRunRow[];
    return rows.map(toRun);
  }
}
