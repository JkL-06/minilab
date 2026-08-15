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
}
