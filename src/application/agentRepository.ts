import type { Agent } from '../domain/agent';

/**
 * Persistence boundary for Agents. The application layer depends on this
 * interface; infrastructure provides the SQLite implementation.
 */
export interface AgentRepository {
  insert(agent: Agent): void;
  findById(id: string): Agent | null;
  findByLab(labId: string): Agent[];
  update(agent: Agent): void;
}
