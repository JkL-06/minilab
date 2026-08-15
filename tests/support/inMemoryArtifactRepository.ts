import type { ArtifactRepository } from '../../src/application/artifactRepository';
import type { Artifact } from '../../src/domain/artifact';

/**
 * In-memory ArtifactRepository for service/API tests. Not used by the
 * persistence and restart tests, which exercise the real SQLite repository.
 * `findByProject` returns newest-first, matching the SQLite implementation.
 */
export function inMemoryArtifactRepository(): ArtifactRepository & { artifacts: Artifact[] } {
  const artifacts: Artifact[] = [];
  return {
    artifacts,
    insert(artifact: Artifact): void {
      artifacts.push(artifact);
    },
    findById(id: string): Artifact | null {
      return artifacts.find((artifact) => artifact.id === id) ?? null;
    },
    findByProject(projectId: string): Artifact[] {
      return artifacts
        .filter((artifact) => artifact.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
