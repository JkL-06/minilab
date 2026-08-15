import { Router } from 'express';
import { z } from 'zod';

import type { ModelConfigService } from '../application/modelConfigService';
import type { ModelGateway } from '../application/modelGateway';
import { MODEL_PROVIDERS } from '../domain/modelConfig';
import type { ModelRequest } from '../domain/model';
import { requireUser } from './auth';
import { handle } from './handlers';

const providerEnum = z.enum(MODEL_PROVIDERS);

/**
 * Request bodies are `.strict()` like the other resources. Model configs are
 * the one place a credential is accepted — under the explicit `apiKey` field —
 * while `api_key`/`secret`/unknown keys are still rejected (SPEC-005 #5), and
 * responses always go through `toView`, which never returns the key.
 */
const createModelConfigSchema = z
  .object({
    name: z.string().min(1, 'name must not be empty').max(100),
    provider: providerEnum,
    model: z.string().min(1, 'model must not be empty').max(200),
    baseUrl: z.string().url('baseUrl must be a valid URL').max(500).nullish(),
    apiKey: z.string().min(1, 'apiKey must not be empty').max(2000).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();

const updateModelConfigSchema = z
  .object({
    name: z.string().min(1, 'name must not be empty').max(100).optional(),
    provider: providerEnum.optional(),
    model: z.string().min(1, 'model must not be empty').max(200).optional(),
    baseUrl: z.string().url('baseUrl must be a valid URL').max(500).nullish(),
    apiKey: z.string().min(1, 'apiKey must not be empty').max(2000).nullish(),
    isEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const TEST_REQUEST: ModelRequest = {
  messages: [{ role: 'user', content: 'Reply with the single word "pong".' }],
};

/**
 * SPEC-005 routes:
 *   POST   /labs/:labId/model-configs        configure a provider (credential encrypted at rest)
 *   GET    /labs/:labId/model-configs        list a Lab's model configs (redacted)
 *   GET    /model-configs/:modelConfigId     get one config (redacted)
 *   PATCH  /model-configs/:modelConfigId     update (replace/clear the key, switch provider/model)
 *   POST   /model-configs/:modelConfigId/test  call the ModelGateway against this config
 */
export function modelConfigRouter(
  service: ModelConfigService,
  gateway: ModelGateway,
): Router {
  const router = Router();

  router.use(requireUser);

  router.post(
    '/labs/:labId/model-configs',
    handle((req, res) => {
      const input = createModelConfigSchema.parse(req.body);
      const config = service.createModelConfig(req.userId, req.params.labId, input);
      res.status(201).json({ modelConfig: service.toView(config) });
    }),
  );

  router.get(
    '/labs/:labId/model-configs',
    handle((req, res) => {
      const modelConfigs = service
        .listModelConfigs(req.userId, req.params.labId)
        .map((config) => service.toView(config));
      res.json({ modelConfigs });
    }),
  );

  router.get(
    '/model-configs/:modelConfigId',
    handle((req, res) => {
      const config = service.getModelConfig(req.userId, req.params.modelConfigId);
      res.json({ modelConfig: service.toView(config) });
    }),
  );

  router.patch(
    '/model-configs/:modelConfigId',
    handle((req, res) => {
      const patch = updateModelConfigSchema.parse(req.body);
      const config = service.updateModelConfig(req.userId, req.params.modelConfigId, patch);
      res.json({ modelConfig: service.toView(config) });
    }),
  );

  /**
   * Demonstrates the gateway path (SPEC-005 #1/#3/#4): the API calls
   * `ModelGateway`, never a provider SDK. `resolveForGateway` enforces Lab
   * ownership and decrypts the credential just for this call.
   */
  router.post(
    '/model-configs/:modelConfigId/test',
    handle(async (req, res) => {
      const { config, apiKey } = service.resolveForGateway(req.userId, req.params.modelConfigId);
      const response = await gateway.generate(TEST_REQUEST, { config, apiKey });
      res.json({
        ok: true,
        provider: config.provider,
        model: response.model,
        content: response.content,
        usage: response.usage,
      });
    }),
  );

  return router;
}
