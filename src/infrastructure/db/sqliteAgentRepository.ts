import type { Agent, AgentStatus } from '../../domain/agent';
import type { AgentRepository } from '../../application/agentRepository';
import type { MiniLabDb } from './database';

interface AgentRow {
  id: string;
  lab_id: string;
  name: string;
  role: string;
  specialization: string | null;
  profile: string | null;
  status: string;
  model_config_id: string | null;
  created_at: string;
  updated_at: string;
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    labId: row.lab_id,
    name: row.name,
    role: row.role,
    specialization: row.specialization,
    profile: row.profile,
    status: row.status as AgentStatus,
    modelConfigId: row.model_config_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(agent: Agent): AgentRow {
  return {
    id: agent.id,
    lab_id: agent.labId,
    name: agent.name,
    role: agent.role,
    specialization: agent.specialization,
    profile: agent.profile,
    status: agent.status,
    model_config_id: agent.modelConfigId,
    created_at: agent.createdAt,
    updated_at: agent.updatedAt,
  };
}

/** SQLite-backed AgentRepository. Maps snake_case rows to camelCase domain objects. */
export class SqliteAgentRepository implements AgentRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(agent: Agent): void {
    const row = toRow(agent);
    this.db
      .prepare(
        `INSERT INTO agents
           (id, lab_id, name, role, specialization, profile, status, model_config_id, created_at, updated_at)
         VALUES
           (@id, @lab_id, @name, @role, @specialization, @profile, @status, @model_config_id, @created_at, @updated_at)`,
      )
      .run(row);
  }

  findById(id: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
    return row ? toAgent(row) : null;
  }

  findByLab(labId: string): Agent[] {
    const rows = this.db
      .prepare('SELECT * FROM agents WHERE lab_id = ? ORDER BY created_at ASC')
      .all(labId) as AgentRow[];
    return rows.map(toAgent);
  }

  update(agent: Agent): void {
    const row = toRow(agent);
    this.db
      .prepare(
        `UPDATE agents
         SET name = @name, role = @role, specialization = @specialization, profile = @profile,
             status = @status, model_config_id = @model_config_id, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(row);
  }
}
