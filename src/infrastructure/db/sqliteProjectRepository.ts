import type { Project, ProjectStatus, ResearchStage } from '../../domain/project';
import type { ProjectRepository } from '../../application/projectRepository';
import type { MiniLabDb } from './database';

interface ProjectRow {
  id: string;
  lab_id: string;
  team_id: string | null;
  title: string;
  objective: string | null;
  stage: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    labId: row.lab_id,
    teamId: row.team_id,
    title: row.title,
    objective: row.objective,
    stage: row.stage as ResearchStage,
    status: row.status as ProjectStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(project: Project): ProjectRow {
  return {
    id: project.id,
    lab_id: project.labId,
    team_id: project.teamId,
    title: project.title,
    objective: project.objective,
    stage: project.stage,
    status: project.status,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

/** SQLite-backed ProjectRepository. Maps snake_case rows to camelCase domain objects. */
export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(project: Project): void {
    const row = toRow(project);
    this.db
      .prepare(
        `INSERT INTO projects
           (id, lab_id, team_id, title, objective, stage, status, created_at, updated_at)
         VALUES
           (@id, @lab_id, @team_id, @title, @objective, @stage, @status, @created_at, @updated_at)`,
      )
      .run(row);
  }

  findById(id: string): Project | null {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  findByLab(labId: string): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE lab_id = ? ORDER BY created_at ASC')
      .all(labId) as ProjectRow[];
    return rows.map(toProject);
  }

  update(project: Project): void {
    const row = toRow(project);
    this.db
      .prepare(
        `UPDATE projects
         SET team_id = @team_id, title = @title, objective = @objective, stage = @stage,
             status = @status, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(row);
  }
}
