import type { Memory } from '../domain/memory';

/**
 * The "semantic index" surface for relevant-memory search (SPEC-007). The
 * canonical `memories` rows are always the source of truth; this strategy only
 * ranks them for retrieval (ADR-0003). v0.1 ships a deterministic, offline
 * keyword strategy so the whole suite runs without a vector database; a real
 * embedding index can be swapped in behind this same interface.
 */
export interface MemorySearchStrategy {
  search(query: string, candidates: Memory[]): Memory[];
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/**
 * Deterministic relevance scoring over canonical rows: counts the query terms
 * shared with a memory's content, type, and source type, then boosts by
 * importance and breaks ties by recency. Zero shared terms scores zero.
 */
export class KeywordMemorySearch implements MemorySearchStrategy {
  search(query: string, candidates: Memory[]): Memory[] {
    const q = tokens(query);
    if (q.size === 0) {
      return [];
    }
    return candidates
      .map((memory) => ({ memory, score: this.score(q, memory) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) => b.score - a.score || b.memory.createdAt.localeCompare(a.memory.createdAt),
      )
      .map((entry) => entry.memory);
  }

  private score(query: Set<string>, memory: Memory): number {
    const candidate = tokens(memory.content);
    for (const t of tokens(memory.memoryType)) candidate.add(t);
    for (const t of tokens(memory.sourceType)) candidate.add(t);
    let shared = 0;
    for (const term of query) {
      if (candidate.has(term)) {
        shared += 1;
      }
    }
    // Importance is a tie-breaker among matches, never a base score: a memory
    // sharing no query term must score zero, however important it is.
    return shared === 0 ? 0 : shared * 2 + memory.importance;
  }
}
