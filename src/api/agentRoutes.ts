import { Router } from 'express';
import { z } from 'zod';

import type { AgentService } from '../application/agentService';
import { AGENT_STATUSES } from '../domain/agent';
import { requireUser } from './auth';
import { handle } from './handlers';

const statusEnum = z.enum(AGENT_STATUSES);

/**
 * Request bodies are `.strict()`: unknown keys (e.g. `api_key`, `secret`,
 * `apiKey`) are rejected rather than silently dropped, so a provider secret can
 * never slip into an Agent row (SPEC-002 #5).
 */
const createAgentSchema = z
  .object({
    name: z.string().min(1, 'name must not be empty').max(200),
    role: z.string().min(1, 'role must not be empty').max(100).optional(),
    specialization: z.string().max(2000).nullish(),
    profile: z.string().max(10_000).nullish(),
    status: statusEnum.optional(),
    modelConfigId: z.string().min(1).max(200).nullish(),
  })
  .strict();

const updateAgentSchema = z
  .object({
    name: z.string().min(1, 'name must not be empty').max(200).optional(),
    role: z.string().min(1, 'role must not be empty').max(100).optional(),
    specialization: z.string().max(2000).nullish(),
    profile: z.string().max(10_000).nullish(),
    status: statusEnum.optional(),
    modelConfigId: z.string().min(1).max(200).nullish(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * SPEC-002 routes:
 *   POST  /labs/:labId/agents   hire an Agent into a Lab
 *   GET   /labs/:labId/agents   list a Lab's Agents
 *   GET   /agents/:agentId      get an Agent by ID
 *   PATCH /agents/:agentId      update an Agent (deactivate via status)
 */
export function agentRouter(service: AgentService): Router {
  const router = Router();

  router.use(requireUser);

  router.post(
    '/labs/:labId/agents',
    handle((req, res) => {
      const input = createAgentSchema.parse(req.body);
      const agent = service.createAgent(req.userId, req.params.labId, input);
      res.status(201).json({ agent });
    }),
  );

  router.get(
    '/labs/:labId/agents',
    handle((req, res) => {
      const agents = service.listAgents(req.userId, req.params.labId);
      res.json({ agents });
    }),
  );

  router.get(
    '/agents/:agentId',
    handle((req, res) => {
      const agent = service.getAgent(req.userId, req.params.agentId);
      res.json({ agent });
    }),
  );

  router.patch(
    '/agents/:agentId',
    handle((req, res) => {
      const patch = updateAgentSchema.parse(req.body);
      const agent = service.updateAgent(req.userId, req.params.agentId, patch);
      res.json({ agent });
    }),
  );

  return router;
}
