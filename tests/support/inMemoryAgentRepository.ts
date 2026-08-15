import type { AgentRepository } from '../../src/application/agentRepository';
import type { Agent } from '../../src/domain/agent';

/**
 * In-memory AgentRepository for domain/service/API tests. Not used by the
 * persistence and restart tests, which exercise the real SQLite repository.
 */
export function inMemoryAgentRepository(): AgentRepository & { agents: Agent[] } {
  const agents: Agent[] = [];
  return {
    agents,
    insert(agent: Agent): void {
      agents.push(agent);
    },
    findById(id: string): Agent | null {
      return agents.find((agent) => agent.id === id) ?? null;
    },
    findByLab(labId: string): Agent[] {
      return agents.filter((agent) => agent.labId === labId);
    },
    update(agent: Agent): void {
      const index = agents.findIndex((existing) => existing.id === agent.id);
      if (index === -1) {
        throw new Error(`Agent not found in memory: ${agent.id}`);
      }
      agents[index] = agent;
    },
  };
}
