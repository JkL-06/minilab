import type { LabRepository } from '../../src/application/labRepository';
import type { Lab } from '../../src/domain/lab';

/**
 * In-memory LabRepository for domain/service/API tests. Not used by the
 * persistence and restart tests, which exercise the real SQLite repository.
 */
export function inMemoryLabRepository(): LabRepository & { labs: Lab[] } {
  const labs: Lab[] = [];
  return {
    labs,
    insert(lab: Lab): void {
      labs.push(lab);
    },
    findById(id: string): Lab | null {
      return labs.find((lab) => lab.id === id) ?? null;
    },
    findByOwner(ownerUserId: string): Lab[] {
      return labs.filter((lab) => lab.ownerUserId === ownerUserId);
    },
    update(lab: Lab): void {
      const index = labs.findIndex((existing) => existing.id === lab.id);
      if (index === -1) {
        throw new Error(`Lab not found in memory: ${lab.id}`);
      }
      labs[index] = lab;
    },
  };
}
