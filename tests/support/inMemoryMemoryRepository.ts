import type { MemoryListFilter, MemoryRepository } from '../../src/application/memoryRepository';
import type { Memory } from '../../src/domain/memory';

/**
 * In-memory MemoryRepository for service/API tests. Not used by the
 * persistence and restart tests, which exercise the real SQLite repository.
 * `findByLab` returns newest-first, matching the SQLite implementation.
 */
export function inMemoryMemoryRepository(): MemoryRepository & { memories: Memory[] } {
  const memories: Memory[] = [];
  return {
    memories,
    insert(memory: Memory): void {
      memories.push(memory);
    },
    findById(id: string): Memory | null {
      return memories.find((memory) => memory.id === id) ?? null;
    },
    findByLab(labId: string, filter?: MemoryListFilter): Memory[] {
      return memories
        .filter((memory) => memory.labId === labId)
        .filter((memory) => (filter?.scope ? memory.scope === filter.scope : true))
        .filter((memory) => (filter?.scopeId ? memory.scopeId === filter.scopeId : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    findBySource(sourceType: string, sourceId: string): Memory[] {
      return memories
        .filter((memory) => memory.sourceType === sourceType && memory.sourceId === sourceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
