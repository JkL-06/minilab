import type { LabRepository } from '../../src/application/labRepository';
import type { ModelConfigService } from '../../src/application/modelConfigService';
import type { ModelGateway } from '../../src/application/modelGateway';
import { ModelConfigService as ModelConfigServiceImpl } from '../../src/application/modelConfigService';
import { ModelGatewayService } from '../../src/application/modelGateway';
import { AesGcmCredentialCipher } from '../../src/infrastructure/models/credentialCipher';
import { MockProviderAdapter } from '../../src/infrastructure/models/adapters/mockProviderAdapter';
import { inMemoryModelConfigRepository } from './inMemoryModelConfigRepository';

/** Fixed-key cipher so service/API tests exercise real encrypt/decrypt deterministically. */
export const testCipher = new AesGcmCredentialCipher(Buffer.alloc(32, 7));

export interface TestModelInfra {
  modelConfigService: ModelConfigService;
  gateway: ModelGateway;
  mock: MockProviderAdapter;
}

/**
 * Builds an in-memory ModelConfigService + a gateway whose adapters never hit
 * the network. `mock` is returned so tests can script responses/failures.
 */
export function testModelInfra(labRepo: LabRepository): TestModelInfra {
  const modelConfigService = new ModelConfigServiceImpl(
    inMemoryModelConfigRepository(),
    labRepo,
    testCipher,
  );
  const mock = new MockProviderAdapter('mock');
  const gateway = new ModelGatewayService({
    openai_compatible: new MockProviderAdapter('openai_compatible'),
    mock,
  });
  return { modelConfigService, gateway, mock };
}
