import type {
  Artifact,
  ArtifactMetadata,
} from '../../domain/artifact';
import type { ArtifactRepository } from '../../application/artifactRepository';
import type { MiniLabDb } from './database';

interface ArtifactRow {
  id: string;
  project_id: string;
  task_id: string | null;
  creator_agent_id: string | null;
  type: string;
  title: string;
  content: string;
  version: number;
  metadata: string | null;
  created_at: string;
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    creatorAgentId: row.creator_agent_id,
    type: row.type,
    title: row.title,
    content: row.content,
    version: row.version,
    metadata: row.metadata ? (JSON.parse(row.metadata) as ArtifactMetadata) : null,
    createdAt: row.created_at,
  };
}

function toRow(artifact: Artifact): ArtifactRow {
  return {
    id: artifact.id,
    project_id: artifact.projectId,
    task_id: artifact.taskId,
    creator_agent_id: artifact.creatorAgentId,
    type: artifact.type,
    title: artifact.title,
    content: artifact.content,
    version: artifact.version,
    metadata: artifact.metadata ? JSON.stringify(artifact.metadata) : null,
    created_at: artifact.createdAt,
  };
}

/**
 * SQLite-backed ArtifactRepository. Canonical rows are the source of truth for
 * research output (ADR-0004); the run transcript is never the only home for an
 * artifact's content (SPEC-008 acceptance #5).
 */
export class SqliteArtifactRepository implements ArtifactRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(artifact: Artifact): void {
    this.db
      .prepare(
        `INSERT INTO artifacts
           (id, project_id, task_id, creator_agent_id, type, title, content,
            version, metadata, created_at)
         VALUES
           (@id, @project_id, @task_id, @creator_agent_id, @type, @title, @content,
            @version, @metadata, @created_at)`,
      )
      .run(toRow(artifact));
  }

  findById(id: string): Artifact | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as
      | ArtifactRow
      | undefined;
    return row ? toArtifact(row) : null;
  }

  findByProject(projectId: string): Artifact[] {
    const rows = this.db
      .prepare('SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as ArtifactRow[];
    return rows.map(toArtifact);
  }
}
