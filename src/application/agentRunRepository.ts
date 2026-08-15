import type { AgentRun } from '../domain/agentRun';

/**
 * Persistence boundary for Agent Runs. The application layer depends on this
 * interface; infrastructure provides the SQLite implementation.
 */
export interface AgentRunRepository {
  insert(run: AgentRun): void;
  findById(id: string): AgentRun | null;
  /** All runs for an Agent, newest first (a run log reads naturally this way). */
  findByAgent(agentId: string): AgentRun[];
}
