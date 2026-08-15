import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { migrate } from './migrations';

export type MiniLabDb = Database.Database;

/**
 * Opens (or creates) the SQLite database used as the relational system of
 * record (ADR-0001), applies pending migrations, and returns the connection.
 *
 * `filename` may be a file path or ':memory:'. The parent directory is created
 * when needed so a fresh install can start with an empty data directory.
 */
export function openDatabase(filename: string): MiniLabDb {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
