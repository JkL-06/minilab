import type { Artifact } from '../domain/artifact';

/**
 * Persistence boundary for Artifacts (SPEC-008). Implementations are SQLite-backed
 * in production and in-memory in service/API tests. Version lineage is a set of
 * sibling rows sharing a Project (ADR-0004).
 */
export interface ArtifactRepository {
  insert(artifact: Artifact): void;
  findById(id: string): Artifact | null;
  /** All artifacts of a Project, newest first. */
  findByProject(projectId: string): Artifact[];
}
