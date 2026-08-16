import type { SynthesizeResult, VoicePrefs, VoiceService } from '../../src/application/voiceService';

/**
 * Test double for VoiceService. Canned outputs are configurable via the returned
 * accessors; every call is recorded on `calls` so tests can assert what reached
 * the service. Never touches the network.
 */
export interface TestVoiceService extends VoiceService {
  calls: Array<{
    kind: 'tts' | 'asr';
    userId: string;
    labId: string;
    text?: string;
    audio?: Buffer;
    mime?: string;
    prefs?: VoicePrefs;
  }>;
  synthesizeResult: SynthesizeResult;
  transcribeResult: string;
  failWith: Error | null;
}

export function testVoiceService(): TestVoiceService {
  const state = {
    calls: [] as TestVoiceService['calls'],
    synthesizeResult: { audio: Buffer.from('fake-audio'), mime: 'audio/mp3' },
    transcribeResult: '转写出的文字',
    failWith: null as Error | null,
  };
  return {
    get calls() {
      return state.calls;
    },
    get synthesizeResult() {
      return state.synthesizeResult;
    },
    set synthesizeResult(v) {
      state.synthesizeResult = v;
    },
    get transcribeResult() {
      return state.transcribeResult;
    },
    set transcribeResult(v) {
      state.transcribeResult = v;
    },
    get failWith() {
      return state.failWith;
    },
    set failWith(v) {
      state.failWith = v;
    },
    async synthesize(userId, labId, text, prefs) {
      state.calls.push({ kind: 'tts', userId, labId, text, prefs });
      if (state.failWith) throw state.failWith;
      return state.synthesizeResult;
    },
    async transcribe(userId, labId, audio, mime, prefs) {
      state.calls.push({ kind: 'asr', userId, labId, audio, mime, prefs });
      if (state.failWith) throw state.failWith;
      return state.transcribeResult;
    },
  };
}
