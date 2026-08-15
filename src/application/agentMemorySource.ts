/**
 * Authorized memory retrieval for the Agent Runtime (SPEC-006 #3).
 *
 * The Runtime asks the Memory subsystem (SPEC-007, not yet built) for the
 * memory the Agent is permitted to see, scoped to its Lab/Project. Every item
 * retains provenance so the model never sees bare text without a source
 * (AGENT_RUNTIME.md step 4). v0.1 ships an empty implementation; tests inject a
 * fake to prove the retrieval + provenance flow reaches the prompt.
 */

export type RetrievedMemoryScope = 'agent' | 'project' | 'team' | 'lab';

export interface RetrievedMemory {
  id: string;
  scope: RetrievedMemoryScope;
  sourceType: string;
  sourceId: string;
  authorType: string;
  authorId: string;
  content: string;
  createdAt: string;
}

export interface AgentMemorySource {
  retrieveAuthorizedMemory(params: {
    labId: string;
    agentId: string;
    projectId: string;
  }): RetrievedMemory[];
}
