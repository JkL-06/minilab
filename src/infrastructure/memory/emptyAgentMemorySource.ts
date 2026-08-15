import type { AgentMemorySource, RetrievedMemory } from '../../application/agentMemorySource';

/**
 * v0.1 memory source: the Memory subsystem (SPEC-007) is not built, so the
 * Runtime retrieves no memory. The retrieval call itself is wired so the
 * interface contract holds and later specs can swap in a real implementation.
 */
export class EmptyAgentMemorySource implements AgentMemorySource {
  retrieveAuthorizedMemory(): RetrievedMemory[] {
    return [];
  }
}
