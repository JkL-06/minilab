import type { UserRepository } from '../../src/application/userRepository';
import type { User } from '../../src/domain/user';

/**
 * In-memory UserRepository for domain/service/API tests. Not used by the
 * persistence and restart tests, which exercise the real SQLite repository.
 */
export function inMemoryUserRepository(): UserRepository & { users: User[] } {
  const users: User[] = [];
  return {
    users,
    insert(user: User): void {
      users.push(user);
    },
    findById(id: string): User | null {
      return users.find((user) => user.id === id) ?? null;
    },
    findByUsername(username: string): User | null {
      return users.find((user) => user.username === username.toLowerCase()) ?? null;
    },
    update(user: User): void {
      const index = users.findIndex((existing) => existing.id === user.id);
      if (index === -1) {
        throw new Error(`User not found in memory: ${user.id}`);
      }
      users[index] = user;
    },
    count(): number {
      return users.length;
    },
  };
}
