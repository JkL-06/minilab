import { applyLabUpdate, createLab, type Lab, type LabUpdatePatch } from '../domain/lab';
import { LabForbiddenError, LabNotFoundError } from '../domain/errors';
import type { LabRepository } from './labRepository';

/**
 * Application service for Labs.
 *
 * Encapsulates the ownership rule from DOMAIN_MODEL.md: every read or write
 * must be authorized against the requesting user's ownership of the Lab.
 */
export class LabService {
  constructor(private readonly repository: LabRepository) {}

  createLab(ownerUserId: string, name: string, description?: string | null): Lab {
    const lab = createLab({ ownerUserId, name, description });
    this.repository.insert(lab);
    return lab;
  }

  getLab(requesterUserId: string, labId: string): Lab {
    const lab = this.requireLab(labId);
    this.assertOwner(requesterUserId, lab);
    return lab;
  }

  listLabs(requesterUserId: string): Lab[] {
    return this.repository.findByOwner(requesterUserId);
  }

  updateLab(requesterUserId: string, labId: string, patch: LabUpdatePatch): Lab {
    const lab = this.requireLab(labId);
    this.assertOwner(requesterUserId, lab);
    const updated = applyLabUpdate(lab, patch);
    this.repository.update(updated);
    return updated;
  }

  private requireLab(labId: string): Lab {
    const lab = this.repository.findById(labId);
    if (!lab) {
      throw new LabNotFoundError(labId);
    }
    return lab;
  }

  private assertOwner(requesterUserId: string, lab: Lab): void {
    if (lab.ownerUserId !== requesterUserId) {
      throw new LabForbiddenError();
    }
  }
}
