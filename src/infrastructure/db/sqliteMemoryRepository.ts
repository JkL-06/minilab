import type {
  Memory,
  MemoryAuthorType,
  MemoryScope,
} from '../../domain/memory';
import type { MemoryListFilter, MemoryRepository } from '../../application/memoryRepository';
import type { MiniLabDb } from './database';

interface MemoryRow {
  id: string;
  lab_id: string;
  scope_type: string;
  scope_id: string | null;
  memory_type: string;
  content: string;
  source_type: string;
  source_id: string;
  author_type: string;
  author_id: string;
  importance: number;
  created_at: string;
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    labId: row.lab_id,
    scope: row.scope_type as MemoryScope,
    scopeId: row.scope_id,
    memoryType: row.memory_type,
    content: row.content,
    sourceType: row.source_type,
    sourceId: row.source_id,
    authorType: row.author_type as MemoryAuthorType,
    authorId: row.author_id,
    importance: row.importance,
    createdAt: row.created_at,
  };
}

function toRow(memory: Memory): MemoryRow {
  return {
    id: memory.id,
    lab_id: memory.labId,
    scope_type: memory.scope,
    scope_id: memory.scopeId,
    memory_type: memory.memoryType,
    content: memory.content,
    source_type: memory.sourceType,
    source_id: memory.sourceId,
    author_type: memory.authorType,
    author_id: memory.authorId,
    importance: memory.importance,
    created_at: memory.createdAt,
  };
}

/**
 * SQLite-backed MemoryRepository. Canonical rows are the source of truth
 * (ADR-0003); a search strategy only ranks them for retrieval.
 */
export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(memory: Memory): void {
    const row = toRow(memory);
    this.db
      .prepare(
        `INSERT INTO memories
           (id, lab_id, scope_type, scope_id, memory_type, content, source_type,
            source_id, author_type, author_id, importance, created_at)
         VALUES
           (@id, @lab_id, @scope_type, @scope_id, @memory_type, @content, @source_type,
            @source_id, @author_type, @author_id, @importance, @created_at)`,
      )
      .run(row);
  }

  findById(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
      | MemoryRow
      | undefined;
    return row ? toMemory(row) : null;
  }

  findByLab(labId: string, filter?: MemoryListFilter): Memory[] {
    let sql = 'SELECT * FROM memories WHERE lab_id = ?';
    const params: unknown[] = [labId];
    if (filter?.scope) {
      sql += ' AND scope_type = ?';
      params.push(filter.scope);
    }
    if (filter?.scopeId) {
      sql += ' AND scope_id = ?';
      params.push(filter.scopeId);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(toMemory);
  }

  findBySource(sourceType: string, sourceId: string): Memory[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM memories WHERE source_type = ? AND source_id = ? ORDER BY created_at DESC',
      )
      .all(sourceType, sourceId) as MemoryRow[];
    return rows.map(toMemory);
  }
}
