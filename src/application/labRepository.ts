import type { Lab } from '../domain/lab';

/**
 * Persistence boundary for Labs.
 *
 * The application layer depends on this interface, not on any concrete
 * database. Infrastructure provides the SQLite implementation.
 */
export interface LabRepository {
  insert(lab: Lab): void;
  findById(id: string): Lab | null;
  findByOwner(ownerUserId: string): Lab[];
  update(lab: Lab): void;
  /**
   * Transfers every Lab owned by `fromOwnerUserId` to `toOwnerUserId`.
   * Used on first-run setup to adopt the legacy `local-pi` data under the
   * new 0th user. Returns the number of Labs reassigned.
   */
  reassignOwner(fromOwnerUserId: string, toOwnerUserId: string): number;
}
