import type { ProjectRepository } from '../../src/application/projectRepository';
import type { Project } from '../../src/domain/project';

/**
 * In-memory ProjectRepository for domain/service/API tests. Not used by the
 * persistence and restart tests, which exercise the real SQLite repository.
 */
export function inMemoryProjectRepository(): ProjectRepository & { projects: Project[] } {
  const projects: Project[] = [];
  return {
    projects,
    insert(project: Project): void {
      projects.push(project);
    },
    findById(id: string): Project | null {
      return projects.find((project) => project.id === id) ?? null;
    },
    findByLab(labId: string): Project[] {
      return projects.filter((project) => project.labId === labId);
    },
    update(project: Project): void {
      const index = projects.findIndex((existing) => existing.id === project.id);
      if (index === -1) {
        throw new Error(`Project not found in memory: ${project.id}`);
      }
      projects[index] = project;
    },
  };
}
