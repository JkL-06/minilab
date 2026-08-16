import type { User } from '../domain/user';

/**
 * Persistence boundary for user accounts.
 *
 * The application layer depends on this interface, not on any concrete
 * database. Infrastructure provides the SQLite implementation.
 */
export interface UserRepository {
  insert(user: User): void;
  findById(id: string): User | null;
  findByUsername(username: string): User | null;
  update(user: User): void;
  count(): number;
}
