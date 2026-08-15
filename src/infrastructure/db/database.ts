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
  // 打包成桌面版（pkg）时，bin/minilab.js 会把嵌入的 .node 原生绑定
  // require() 出来存进 __minilabSqliteAddon，用它绕开 `bindings` 包的
  // fs 探测（pkg 资产对 fs 不可见）。开发/普通运行没有该全局变量，走默认路径。
  const addon = (globalThis as { __minilabSqliteAddon?: unknown }).__minilabSqliteAddon;
  const db =
    addon != null
      ? new Database(filename, { nativeBinding: addon as unknown as string })
      : new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
