import type { User } from '../../domain/user';
import { parsePreferences } from '../../domain/user';
import type { UserRepository } from '../../application/userRepository';
import type { MiniLabDb } from './database';

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  role: 'owner' | 'member';
  password_hash: string;
  preferences: string;
  created_at: string;
  updated_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    bio: row.bio,
    role: row.role,
    passwordHash: row.password_hash,
    preferences: parsePreferences(row.preferences),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(user: User): UserRow {
  return {
    id: user.id,
    username: user.username,
    display_name: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    role: user.role,
    password_hash: user.passwordHash,
    preferences: JSON.stringify(user.preferences),
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  };
}

/** SQLite-backed UserRepository. Maps snake_case rows to camelCase domain objects. */
export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(user: User): void {
    const row = toRow(user);
    this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, avatar, bio, role, password_hash, preferences, created_at, updated_at)
         VALUES (@id, @username, @display_name, @avatar, @bio, @role, @password_hash, @preferences, @created_at, @updated_at)`,
      )
      .run(row);
  }

  findById(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  findByUsername(username: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username.toLowerCase()) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  update(user: User): void {
    const row = toRow(user);
    this.db
      .prepare(
        `UPDATE users
         SET display_name = @display_name, avatar = @avatar, bio = @bio, role = @role,
             password_hash = @password_hash, preferences = @preferences, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(row);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    return row.c;
  }
}
