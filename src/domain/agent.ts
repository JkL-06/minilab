import { randomUUID } from 'node:crypto';

import { AgentValidationError } from './errors';

/**
 * Agent is a persistent AI lab member (SPEC-002).
 *
 * Per AGENT_RUNTIME.md an Agent is conceptually
 * `Identity + Context + Memory + Model + Tools + Authority`; what is persisted
 * here is the durable identity: it belongs to exactly one Lab (DOMAIN_MODEL
 * invariant #1) and carries only a *reference* to a model configuration —
 * provider secrets never live in the Agent row.
 */
export const AGENT_STATUSES: ['active', 'inactive'] = ['active', 'inactive'];

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const DEFAULT_AGENT_ROLE = 'researcher';

export interface Agent {
  id: string;
  labId: string;
  name: string;
  role: string;
  specialization: string | null;
  profile: string | null;
  status: AgentStatus;
  modelConfigId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  labId: string;
  name: string;
  role?: string;
  specialization?: string | null;
  profile?: string | null;
  status?: AgentStatus;
  modelConfigId?: string | null;
}

export interface AgentUpdatePatch {
  name?: unknown;
  role?: unknown;
  specialization?: unknown;
  profile?: unknown;
  status?: unknown;
  modelConfigId?: unknown;
}

export function validateAgentName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new AgentValidationError('name must be a string');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new AgentValidationError('name must not be empty');
  }
  return trimmed;
}

export function validateAgentRole(role: unknown): string {
  if (typeof role !== 'string') {
    throw new AgentValidationError('role must be a string');
  }
  const trimmed = role.trim();
  if (trimmed.length === 0) {
    throw new AgentValidationError('role must not be empty');
  }
  return trimmed;
}

export function validateAgentStatus(status: unknown): AgentStatus {
  if (status !== 'active' && status !== 'inactive') {
    throw new AgentValidationError("status must be 'active' or 'inactive'");
  }
  return status;
}

/** A model configuration reference is an ID, never a credential (SPEC-002 #5). */
export function validateModelConfigId(id: unknown): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new AgentValidationError('modelConfigId must be a non-empty string reference');
  }
  return id.trim();
}

/** Creates a new Agent with an immutable ID, a single Lab owner, and UTC timestamps. */
export function createAgent(input: CreateAgentInput): Agent {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    labId: input.labId,
    name: validateAgentName(input.name),
    role: input.role === undefined ? DEFAULT_AGENT_ROLE : validateAgentRole(input.role),
    specialization: input.specialization ?? null,
    profile: input.profile ?? null,
    status: input.status === undefined ? 'active' : validateAgentStatus(input.status),
    modelConfigId: input.modelConfigId == null ? null : validateModelConfigId(input.modelConfigId),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Applies a partial update to an Agent. Only supplied fields change;
 * `status: 'inactive'` deactivates without deleting the record (SPEC-002 #6).
 * `updatedAt` is always bumped.
 */
export function applyAgentUpdate(agent: Agent, patch: AgentUpdatePatch): Agent {
  const next: Agent = { ...agent };
  if ('name' in patch) {
    next.name = validateAgentName(patch.name);
  }
  if ('role' in patch) {
    next.role = validateAgentRole(patch.role);
  }
  if ('specialization' in patch) {
    next.specialization = patch.specialization == null ? null : String(patch.specialization);
  }
  if ('profile' in patch) {
    next.profile = patch.profile == null ? null : String(patch.profile);
  }
  if ('status' in patch) {
    next.status = validateAgentStatus(patch.status);
  }
  if ('modelConfigId' in patch) {
    next.modelConfigId =
      patch.modelConfigId == null ? null : validateModelConfigId(patch.modelConfigId);
  }
  next.updatedAt = new Date().toISOString();
  return next;
}
