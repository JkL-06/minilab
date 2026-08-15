import type { Lab } from '../../domain/lab';
import type { LabRepository } from '../../application/labRepository';
import type { MiniLabDb } from './database';

interface LabRow {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function toLab(row: LabRow): Lab {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(lab: Lab): LabRow {
  return {
    id: lab.id,
    owner_user_id: lab.ownerUserId,
    name: lab.name,
    description: lab.description,
    created_at: lab.createdAt,
    updated_at: lab.updatedAt,
  };
}

/** SQLite-backed LabRepository. Maps snake_case rows to camelCase domain objects. */
export class SqliteLabRepository implements LabRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(lab: Lab): void {
    const row = toRow(lab);
    this.db
      .prepare(
        `INSERT INTO labs (id, owner_user_id, name, description, created_at, updated_at)
         VALUES (@id, @owner_user_id, @name, @description, @created_at, @updated_at)`,
      )
      .run(row);
  }

  findById(id: string): Lab | null {
    const row = this.db.prepare('SELECT * FROM labs WHERE id = ?').get(id) as LabRow | undefined;
    return row ? toLab(row) : null;
  }

  findByOwner(ownerUserId: string): Lab[] {
    const rows = this.db
      .prepare('SELECT * FROM labs WHERE owner_user_id = ? ORDER BY created_at ASC')
      .all(ownerUserId) as LabRow[];
    return rows.map(toLab);
  }

  update(lab: Lab): void {
    const row = toRow(lab);
    this.db
      .prepare('UPDATE labs SET name = @name, description = @description, updated_at = @updated_at WHERE id = @id')
      .run(row);
  }
}
