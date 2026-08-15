import { LabForbiddenError, LabNotFoundError } from '../domain/errors';
import type { LabRepository } from './labRepository';

/**
 * Enforces Lab ownership for any lab-scoped operation (cross-lab reads/writes
 * are rejected; the requesting user must own the Lab). Shared by every service
 * that hosts resources inside a Lab (SPEC-001 #3, SPEC-002 #4, SPEC-003 #3).
 */
export function assertLabOwnedBy(
  labs: LabRepository,
  userId: string,
  labId: string,
): void {
  const lab = labs.findById(labId);
  if (!lab) {
    throw new LabNotFoundError(labId);
  }
  if (lab.ownerUserId !== userId) {
    throw new LabForbiddenError();
  }
}
