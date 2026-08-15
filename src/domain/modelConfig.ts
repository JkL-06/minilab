import { randomUUID } from 'node:crypto';

import { ModelConfigValidationError } from './errors';

/**
 * User-supplied model/API configuration (SPEC-005) — the "secure credential
 * reference" an Agent points at via `modelConfigId` (SPEC-002).
 *
 * The entity never carries a plaintext credential: `apiKeyEncrypted` holds an
 * opaque ciphertext produced by the application layer before the entity is
 * built, and the API view (`toModelConfigView`) strips even that.
 */
export const MODEL_PROVIDERS: ['openai_compatible', 'mock'] = ['openai_compatible', 'mock'];

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export interface ModelConfig {
  id: string;
  labId: string;
  name: string;
  provider: ModelProvider;
  model: string;
  /** Provider base URL (e.g. `https://api.openai.com/v1`); `null` = adapter default. */
  baseUrl: string | null;
  /** Ciphertext of the API key at rest; never plaintext, never serialized. */
  apiKeyEncrypted: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateModelConfigInput {
  labId: string;
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl?: string | null;
  apiKeyEncrypted?: string | null;
  isEnabled?: boolean;
}

/** `apiKeyEncrypted` absent = keep existing; `null` = clear; string = replace. */
export interface ModelConfigUpdatePatch {
  name?: string;
  provider?: ModelProvider;
  model?: string;
  baseUrl?: string | null;
  apiKeyEncrypted?: string | null;
  isEnabled?: boolean;
}

/** The API-facing shape. Never exposes `apiKeyEncrypted`; only whether one is set. */
export interface ModelConfigView {
  id: string;
  labId: string;
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string | null;
  isEnabled: boolean;
  apiKeyConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export function validateModelConfigName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new ModelConfigValidationError('name must be a string');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ModelConfigValidationError('name must not be empty');
  }
  if (trimmed.length > 100) {
    throw new ModelConfigValidationError('name must be at most 100 characters');
  }
  return trimmed;
}

export function validateModelProvider(provider: unknown): ModelProvider {
  if (
    typeof provider !== 'string' ||
    !(MODEL_PROVIDERS as readonly string[]).includes(provider)
  ) {
    throw new ModelConfigValidationError(
      `provider must be one of: ${MODEL_PROVIDERS.join(', ')}`,
    );
  }
  return provider as ModelProvider;
}

export function validateModelName(model: unknown): string {
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new ModelConfigValidationError('model must not be empty');
  }
  return model.trim();
}

export function validateModelConfigBaseUrl(baseUrl: unknown): string | null {
  if (baseUrl == null) {
    return null;
  }
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new ModelConfigValidationError('baseUrl must not be empty when provided');
  }
  const value = baseUrl.trim();
  if (!/^https?:\/\//i.test(value)) {
    throw new ModelConfigValidationError('baseUrl must be an http(s) URL');
  }
  return value;
}

/** Creates a ModelConfig with an immutable ID, one Lab owner, and UTC timestamps. */
export function createModelConfig(input: CreateModelConfigInput): ModelConfig {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    labId: input.labId,
    name: validateModelConfigName(input.name),
    provider: validateModelProvider(input.provider),
    model: validateModelName(input.model),
    baseUrl: input.baseUrl === undefined ? null : validateModelConfigBaseUrl(input.baseUrl),
    apiKeyEncrypted: input.apiKeyEncrypted ?? null,
    isEnabled: input.isEnabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Applies a partial update; only supplied fields change, `updatedAt` always bumps. */
export function applyModelConfigUpdate(
  config: ModelConfig,
  patch: ModelConfigUpdatePatch,
): ModelConfig {
  const next: ModelConfig = { ...config };
  if ('name' in patch) {
    next.name = validateModelConfigName(patch.name);
  }
  if ('provider' in patch) {
    next.provider = validateModelProvider(patch.provider);
  }
  if ('model' in patch) {
    next.model = validateModelName(patch.model);
  }
  if ('baseUrl' in patch) {
    next.baseUrl = validateModelConfigBaseUrl(patch.baseUrl);
  }
  if ('apiKeyEncrypted' in patch) {
    next.apiKeyEncrypted = patch.apiKeyEncrypted ?? null;
  }
  if ('isEnabled' in patch) {
    next.isEnabled = patch.isEnabled === true;
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

/** Redaction boundary: the persisted ciphertext never crosses to the API. */
export function toModelConfigView(config: ModelConfig): ModelConfigView {
  return {
    id: config.id,
    labId: config.labId,
    name: config.name,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    isEnabled: config.isEnabled,
    apiKeyConfigured: config.apiKeyEncrypted != null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}
