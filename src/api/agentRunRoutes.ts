import { Router } from 'express';
import { z } from 'zod';

import type { AgentRuntimeService } from '../application/agentRuntimeService';
import { requireUser } from './auth';
import { handle } from './handlers';

const createRunSchema = z
  .object({
    taskId: z.string().min(1, 'taskId must not be empty').max(200),
    instruction: z.string().max(10_000).optional(),
    maxTokens: z.number().int('maxTokens must be an integer').positive('maxTokens must be positive').max(1_000_000).optional(),
  })
  .strict();

/**
 * SPEC-006 routes:
 *   POST /agents/:agentId/runs   execute one bounded task for the Agent
 *   GET  /agents/:agentId/runs   list the Agent's run log (newest first)
 *   GET  /runs/:runId            get one run by ID
 *
 * A run is always created for an execution attempt (even a classified failure),
 * so every model execution is traceable by ID (SPEC-006 acceptance #4).
 */
export function agentRunRouter(runtime: AgentRuntimeService): Router {
  const router = Router();

  router.use(requireUser);

  router.post(
    '/agents/:agentId/runs',
    handle(async (req, res) => {
      const input = createRunSchema.parse(req.body);
      const run = await runtime.runOnce({
        requesterUserId: req.userId,
        agentId: req.params.agentId,
        taskId: input.taskId,
        instruction: input.instruction,
        maxTokens: input.maxTokens,
      });
      res.status(201).json({ run });
    }),
  );

  router.get(
    '/agents/:agentId/runs',
    handle((req, res) => {
      const runs = runtime.listRuns(req.userId, req.params.agentId);
      res.json({ runs });
    }),
  );

  router.get(
    '/runs/:runId',
    handle((req, res) => {
      const run = runtime.getRun(req.userId, req.params.runId);
      res.json({ run });
    }),
  );

  return router;
}
