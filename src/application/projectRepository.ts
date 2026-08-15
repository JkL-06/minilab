import type { Project } from '../domain/project';

/**
 * Persistence boundary for Projects. The application layer depends on this
 * interface; infrastructure provides the SQLite implementation.
 */
export interface ProjectRepository {
  insert(project: Project): void;
  findById(id: string): Project | null;
  findByLab(labId: string): Project[];
  update(project: Project): void;
}
