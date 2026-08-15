import {
  applyModelConfigUpdate,
  createModelConfig,
  toModelConfigView,
  type ModelConfig,
  type ModelConfigUpdatePatch,
  type ModelConfigView,
  type ModelProvider,
} from '../domain/modelConfig';
import { ModelConfigNotFoundError } from '../domain/errors';
import { assertLabOwnedBy } from './labAccess';
import type { LabRepository } from './labRepository';
import type { ModelConfigRepository } from './modelConfigRepository';
import type { SecretCipher } from './secretCipher';

/** `apiKey` is plaintext user input; the service encrypts it before persistence. */
export interface CreateModelConfigParams {
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  isEnabled?: boolean;
}

/** `apiKey` present = replace (null clears); absent = keep the stored credential. */
export interface UpdateModelConfigParams {
  name?: string;
  provider?: ModelProvider;
  model?: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  isEnabled?: boolean;
}

/**
 * Application service for model configurations (SPEC-005).
 *
 * The API only ever sees redacted views (`toView`); plaintext keys are accepted
 * on write and encrypted immediately via the injected `SecretCipher`. All
 * operations are gated on Lab ownership (`assertLabOwnedBy`), so a model config
 * is as lab-scoped as any other entity.
 */
export class ModelConfigService {
  constructor(
    private readonly configs: ModelConfigRepository,
    private readonly labs: LabRepository,
    private readonly cipher: SecretCipher,
  ) {}

  createModelConfig(
    requesterUserId: string,
    labId: string,
    params: CreateModelConfigParams,
  ): ModelConfig {
    this.assertLabOwnedBy(requesterUserId, labId);
    const apiKeyEncrypted = params.apiKey == null ? null : this.cipher.encrypt(params.apiKey);
    const config = createModelConfig({
      labId,
      name: params.name,
      provider: params.provider,
      model: params.model,
      baseUrl: params.baseUrl,
      apiKeyEncrypted,
      isEnabled: params.isEnabled,
    });
    this.configs.insert(config);
    return config;
  }

  listModelConfigs(requesterUserId: string, labId: string): ModelConfig[] {
    this.assertLabOwnedBy(requesterUserId, labId);
    return this.configs.findByLab(labId);
  }

  getModelConfig(requesterUserId: string, modelConfigId: string): ModelConfig {
    const config = this.requireModelConfig(modelConfigId);
    this.assertLabOwnedBy(requesterUserId, config.labId);
    return config;
  }

  updateModelConfig(
    requesterUserId: string,
    modelConfigId: string,
    params: UpdateModelConfigParams,
  ): ModelConfig {
    const config = this.requireModelConfig(modelConfigId);
    this.assertLabOwnedBy(requesterUserId, config.labId);
    const patch: ModelConfigUpdatePatch = {};
    if ('name' in params) patch.name = params.name;
    if ('provider' in params) patch.provider = params.provider;
    if ('model' in params) patch.model = params.model;
    if ('baseUrl' in params) patch.baseUrl = params.baseUrl;
    if ('apiKey' in params) {
      patch.apiKeyEncrypted = params.apiKey == null ? null : this.cipher.encrypt(params.apiKey);
    }
    if ('isEnabled' in params) patch.isEnabled = params.isEnabled;
    const updated = applyModelConfigUpdate(config, patch);
    this.configs.update(updated);
    return updated;
  }

  /** Redacted API shape — never leaks the stored (encrypted) credential. */
  toView(config: ModelConfig): ModelConfigView {
    return toModelConfigView(config);
  }

  /**
   * Resolves a config (with the decrypted secret) for a ModelGateway call.
   * Ownership is enforced here, so gateway callers (the test endpoint now, the
   * Agent Runtime later) never bypass lab isolation.
   */
  resolveForGateway(
    requesterUserId: string,
    modelConfigId: string,
  ): { config: ModelConfig; apiKey: string | null } {
    const config = this.requireModelConfig(modelConfigId);
    this.assertLabOwnedBy(requesterUserId, config.labId);
    const apiKey = config.apiKeyEncrypted == null ? null : this.cipher.decrypt(config.apiKeyEncrypted);
    return { config, apiKey };
  }

  private requireModelConfig(modelConfigId: string): ModelConfig {
    const config = this.configs.findById(modelConfigId);
    if (!config) {
      throw new ModelConfigNotFoundError(modelConfigId);
    }
    return config;
  }

  private assertLabOwnedBy(userId: string, labId: string): void {
    assertLabOwnedBy(this.labs, userId, labId);
  }
}
