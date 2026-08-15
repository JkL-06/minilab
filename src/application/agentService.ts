import {
  applyAgentUpdate,
  createAgent,
  type Agent,
  type AgentUpdatePatch,
  type CreateAgentInput,
} from '../domain/agent';
import { AgentNotFoundError } from '../domain/errors';
import { assertLabOwnedBy } from './labAccess';
import type { AgentRepository } from './agentRepository';
import type { LabRepository } from './labRepository';

type CreateAgentParams = Omit<CreateAgentInput, 'labId'>;

/**
 * Application service for Agents.
 *
 * Every Agent belongs to exactly one Lab (DOMAIN_MODEL invariant #1). All
 * operations are gated on the requesting user owning the Agent's Lab, which
 * rejects cross-lab reads/writes (SPEC-002 #4) and ties "hire" to lab scope.
 */
export class AgentService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly labs: LabRepository,
  ) {}

  createAgent(requesterUserId: string, labId: string, params: CreateAgentParams): Agent {
    this.assertLabOwnedBy(requesterUserId, labId);
    const agent = createAgent({ labId, ...params });
    this.agents.insert(agent);
    return agent;
  }

  listAgents(requesterUserId: string, labId: string): Agent[] {
    this.assertLabOwnedBy(requesterUserId, labId);
    return this.agents.findByLab(labId);
  }

  getAgent(requesterUserId: string, agentId: string): Agent {
    const agent = this.requireAgent(agentId);
    this.assertLabOwnedBy(requesterUserId, agent.labId);
    return agent;
  }

  updateAgent(requesterUserId: string, agentId: string, patch: AgentUpdatePatch): Agent {
    const agent = this.requireAgent(agentId);
    this.assertLabOwnedBy(requesterUserId, agent.labId);
    const updated = applyAgentUpdate(agent, patch);
    this.agents.update(updated);
    return updated;
  }

  private requireAgent(agentId: string): Agent {
    const agent = this.agents.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }
    return agent;
  }

  private assertLabOwnedBy(userId: string, labId: string): void {
    assertLabOwnedBy(this.labs, userId, labId);
  }
}
