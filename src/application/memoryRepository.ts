import type { Memory, MemoryScope } from '../domain/memory';

/** Optional scope narrowing for list/search queries. */
export interface MemoryListFilter {
  scope?: MemoryScope;
  scopeId?: string;
}

/**
 * Canonical memory persistence (ADR-0003). Rows are the source of truth; a
 * search strategy is only an acceleration layer over them.
 */
export interface MemoryRepository {
  insert(memory: Memory): void;
  findById(id: string): Memory | null;
  findByLab(labId: string, filter?: MemoryListFilter): Memory[];
  /** All memories carrying a provenance source (e.g. a Meeting's writes), newest first. */
  findBySource(sourceType: string, sourceId: string): Memory[];
}
