import type { ModelConfigRepository } from '../../src/application/modelConfigRepository';
import type { ModelConfig } from '../../src/domain/modelConfig';

/**
 * In-memory ModelConfigRepository for domain/service/API tests. Not used by
 * the persistence and restart tests, which exercise the real SQLite repository.
 */
export function inMemoryModelConfigRepository(): ModelConfigRepository & {
  modelConfigs: ModelConfig[];
} {
  const modelConfigs: ModelConfig[] = [];
  return {
    modelConfigs,
    insert(config: ModelConfig): void {
      modelConfigs.push(config);
    },
    findById(id: string): ModelConfig | null {
      return modelConfigs.find((config) => config.id === id) ?? null;
    },
    findByLab(labId: string): ModelConfig[] {
      return modelConfigs.filter((config) => config.labId === labId);
    },
    update(config: ModelConfig): void {
      const index = modelConfigs.findIndex((existing) => existing.id === config.id);
      if (index === -1) {
        throw new Error(`Model config not found in memory: ${config.id}`);
      }
      modelConfigs[index] = config;
    },
  };
}
