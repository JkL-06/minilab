import type { ModelConfig } from '../domain/modelConfig';

/**
 * Persistence boundary for ModelConfigs. Operates only on entities, which
 * carry ciphertext — plaintext credentials never cross this interface.
 */
export interface ModelConfigRepository {
  insert(config: ModelConfig): void;
  findById(id: string): ModelConfig | null;
  findByLab(labId: string): ModelConfig[];
  update(config: ModelConfig): void;
}
