import type { AgentRunRepository } from '../../src/application/agentRunRepository';
import type { AgentRun } from '../../src/domain/agentRun';

/**
 * In-memory AgentRunRepository for service/API tests. Not used by the
 * persistence and restart tests, which exercise the real SQLite repository.
 * `findByAgent` returns newest-first, matching the SQLite implementation.
 */
export function inMemoryAgentRunRepository(): AgentRunRepository & { runs: AgentRun[] } {
  const runs: AgentRun[] = [];
  return {
    runs,
    insert(run: AgentRun): void {
      runs.push(run);
    },
    findById(id: string): AgentRun | null {
      return runs.find((run) => run.id === id) ?? null;
    },
    findByAgent(agentId: string): AgentRun[] {
      return runs
        .filter((run) => run.agentId === agentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
