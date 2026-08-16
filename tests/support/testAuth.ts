import { InMemorySessionStore } from '../../src/application/sessionStore';
import { UserService } from '../../src/application/userService';
import { inMemoryLabRepository } from './inMemoryLabRepository';
import { inMemoryUserRepository } from './inMemoryUserRepository';
import { testVoiceService } from './testVoiceService';
import type { VoiceService } from '../../src/application/voiceService';

/**
 * Builds the auth dependencies every `createApp`/`ApiDeps` call needs, for
 * tests that don't exercise user/session/voice behavior directly. Pass the
 * test's own lab repository when one exists so the DI graph is coherent;
 * otherwise a fresh in-memory one is used (fine — these tests authenticate via
 * X-User-Id headers). `voiceService` is a harmless test double; the voice tests
 * swap it for a scripted fake.
 */
export function testAuthDeps(labRepository = inMemoryLabRepository()): {
  userService: UserService;
  sessionStore: InMemorySessionStore;
  voiceService: VoiceService;
} {
  return {
    userService: new UserService(inMemoryUserRepository(), labRepository),
    sessionStore: new InMemorySessionStore(),
    voiceService: testVoiceService(),
  };
}
