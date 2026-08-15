import type { AgentMemorySource, RetrievedMemory } from './agentMemorySource';
import type { AgentRepository } from './agentRepository';
import { MemoryValidationError } from '../domain/errors';
import { assertLabOwnedBy } from './labAccess';
import type { LabRepository } from './labRepository';
import type { MemorySearchStrategy } from './memorySearch';
import type { MemoryListFilter, MemoryRepository } from './memoryRepository';
import { createMemory, type Memory, type MemoryScope } from '../domain/memory';
import type { ProjectRepository } from './projectRepository';

/** PI-authored memory input. `author` is always server-set to the requester. */
export interface WriteMemoryParams {
  scope: MemoryScope;
  scopeId?: string | null;
  memoryType?: string;
  content: string;
  sourceType: string;
  sourceId: string;
  importance?: number;
}

export interface MemorySearchResult {
  query: string;
  memories: Memory[];
  /** true when the search strategy failed and retrieval fell back to scope-based listing. */
  fallback: boolean;
}

/**
 * Persistent scoped memory (SPEC-007, ADR-0003).
 *
 * The PI (Lab owner) writes and reads all scopes in their Lab. Every record is
 * provenance-complete. Retrieval never bypasses authorization: the runtime-facing
 * `retrieveAuthorizedMemory` gives an Agent only its own `agent`-scoped memory,
 * the current project's `project`-scoped memory, and the Lab-shared `team`/`lab`
 * memory. A throwing search strategy degrades to scope-based retrieval and never
 * erases canonical rows (acceptance #6).
 */
export class MemoryService implements AgentMemorySource {
  constructor(
    private readonly memories: MemoryRepository,
    private readonly labs: LabRepository,
    private readonly agents: AgentRepository,
    private readonly projects: ProjectRepository,
    private readonly search: MemorySearchStrategy,
  ) {}

  writeMemory(requesterUserId: string, labId: string, params: WriteMemoryParams): Memory {
    this.assertLabOwnedBy(requesterUserId, labId);
    this.assertScopeTargetInLab(labId, params.scope, params.scopeId ?? null);
    const memory = createMemory({
      labId,
      ...params,
      authorType: 'pi',
      authorId: requesterUserId,
    });
    this.memories.insert(memory);
    return memory;
  }

  /** PI retrieval, optionally narrowed to one scope (and scopeId). */
  listMemory(
    requesterUserId: string,
    labId: string,
    filter?: MemoryListFilter,
  ): Memory[] {
    this.assertLabOwnedBy(requesterUserId, labId);
    return this.memories.findByLab(labId, filter);
  }

  /**
   * PI read of every memory written from one source (e.g. a Meeting's outcome
   * writes, which carry `sourceType: 'meeting'` / `sourceId: <meeting id>`).
   * Lets a Meeting expose its memory write ids without denormalizing them
   * (ADR-0005); provenance on the memory rows is the single source of truth.
   */
  listMemoryBySource(
    requesterUserId: string,
    labId: string,
    sourceType: string,
    sourceId: string,
  ): Memory[] {
    this.assertLabOwnedBy(requesterUserId, labId);
    return this.memories.findBySource(sourceType, sourceId);
  }

  /** Relevant-memory search. Strategy failure falls back to canonical listing. */
  searchMemory(
    requesterUserId: string,
    labId: string,
    query: string,
    filter?: MemoryListFilter,
  ): MemorySearchResult {
    this.assertLabOwnedBy(requesterUserId, labId);
    const candidates = this.memories.findByLab(labId, filter);
    try {
      return { query, memories: this.search.search(query, candidates), fallback: false };
    } catch {
      // A degraded semantic index must never erase or block canonical memory
      // (SPEC-007 acceptance #6).
      return { query, memories: candidates, fallback: true };
    }
  }

  // --- AgentMemorySource (Agent Runtime, SPEC-006 #3) ---
  retrieveAuthorizedMemory(params: {
    labId: string;
    agentId: string;
    projectId: string;
  }): RetrievedMemory[] {
    return this.memories
      .findByLab(params.labId)
      .filter(
        (m) =>
          m.scope === 'agent' ? m.scopeId === params.agentId
          : m.scope === 'project' ? m.scopeId === params.projectId
          : true, // team / lab memory is shared within the Lab
      )
      .map((m) => ({
        id: m.id,
        scope: m.scope,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        authorType: m.authorType,
        authorId: m.authorId,
        content: m.content,
        createdAt: m.createdAt,
      }));
  }

  /**
   * The `scope_id` must reference an entity in the same Lab (cross-Lab
   * references are invalid). `team` has no entity in v0.1 (nullable reference)
   * and `lab` carries no id — both are checked in the domain.
   */
  private assertScopeTargetInLab(labId: string, scope: MemoryScope, scopeId: string | null): void {
    if (scope === 'agent') {
      const agent = this.agents.findById(scopeId!);
      if (!agent || agent.labId !== labId) {
        throw new MemoryValidationError(
          'agent-scoped memory must reference an Agent in this Lab',
        );
      }
    } else if (scope === 'project') {
      const project = this.projects.findById(scopeId!);
      if (!project || project.labId !== labId) {
        throw new MemoryValidationError(
          'project-scoped memory must reference a Project in this Lab',
        );
      }
    }
  }

  private assertLabOwnedBy(userId: string, labId: string): void {
    assertLabOwnedBy(this.labs, userId, labId);
  }
}
