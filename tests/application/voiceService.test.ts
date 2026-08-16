import assert from 'node:assert/strict';
import test from 'node:test';

import { LabService } from '../../src/application/labService';
import { DashScopeVoiceService } from '../../src/application/voiceService';
import { VoiceError } from '../../src/domain/errors';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { testModelInfra } from '../support/testModelGateway';

/**
 * VoiceService tests. The service only speaks HTTP to DashScope, so global fetch
 * is stubbed per-test (`t.mock.method`). The DashScope credential comes from the
 * user's model configs — a config whose baseUrl mentions dashscope with a key.
 */
function setup() {
  const labRepo = inMemoryLabRepository();
  const infra = testModelInfra(labRepo);
  const labService = new LabService(labRepo);
  const userId = 'user-1';
  const lab = labService.createLab(userId, '语音实验室');
  const config = infra.modelConfigService.createModelConfig(userId, lab.id, {
    name: 'dashscope',
    provider: 'openai_compatible',
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'sk-test-123',
  });
  const voice = new DashScopeVoiceService(infra.modelConfigService, 5000);
  return { voice, userId, lab, config };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('synthesize posts to the DashScope TTS endpoint and decodes base64 audio', async (t) => {
  const { voice, userId, lab } = setup();
  const audio = Buffer.from('fake-mp3-bytes');
  let calledUrl = '';
  t.mock.method(globalThis, 'fetch', async (url: string, init: { headers?: Record<string, string>; body?: unknown }) => {
    calledUrl = url;
    assert.equal(init.headers?.Authorization, 'Bearer sk-test-123');
    const parsed = JSON.parse(String(init.body));
    assert.equal(parsed.model, 'cosyvoice-v2');
    assert.equal(parsed.input.text, '你好，世界');
    assert.equal(parsed.voice, 'longxiaochun');
    assert.equal(parsed.parameters.speed, 1.2);
    return jsonResponse({ output: { audio: audio.toString('base64') } });
  });

  const result = await voice.synthesize(userId, lab.id, '你好，世界', { ttsSpeed: 1.2 });
  assert.deepEqual(result.audio, audio);
  assert.equal(result.mime, 'audio/mp3');
  assert.ok(calledUrl.endsWith('/api/v1/services/aigc/text2audio/generation'));
  assert.ok(calledUrl.includes('dashscope.aliyuncs.com'));
});

test('synthesize accepts a raw audio stream when the provider returns one', async (t) => {
  const { voice, userId, lab } = setup();
  const audio = Buffer.from('RIFF....WAVE');
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(new Uint8Array(audio), {
      status: 200,
      headers: { 'content-type': 'audio/wav; charset=utf-8' },
    }),
  );
  const result = await voice.synthesize(userId, lab.id, '读这段');
  assert.deepEqual(result.audio, audio);
  assert.equal(result.mime, 'audio/wav');
});

test('synthesize rejects empty text without touching the network', async () => {
  const { voice, userId, lab } = setup();
  await assert.rejects(
    () => voice.synthesize(userId, lab.id, '   '),
    (err: unknown) => err instanceof VoiceError && err.category === 'invalid_request',
  );
});

test('voice without a DashScope config surfaces a helpful VoiceError', async () => {
  const labRepo = inMemoryLabRepository();
  const infra = testModelInfra(labRepo);
  const labService = new LabService(labRepo);
  const userId = 'user-1';
  const lab = labService.createLab(userId, '无语音配置');
  infra.modelConfigService.createModelConfig(userId, lab.id, {
    name: 'openai',
    provider: 'openai_compatible',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-other',
  });
  const voice = new DashScopeVoiceService(infra.modelConfigService, 5000);
  await assert.rejects(
    () => voice.synthesize(userId, lab.id, 'hi'),
    (err: unknown) =>
      err instanceof VoiceError && err.category === 'invalid_request' && err.message.includes('DashScope'),
  );
});

test('transcribe posts raw audio and returns output.text', async (t) => {
  const { voice, userId, lab } = setup();
  const audio = Buffer.from('fake-webm');
  let calledUrl = '';
  t.mock.method(globalThis, 'fetch', async (url: string, init: { headers?: Record<string, string>; body?: unknown }) => {
    calledUrl = url;
    assert.equal(init.headers?.Authorization, 'Bearer sk-test-123');
    assert.equal(init.headers?.['Content-Type'], 'audio/webm');
    // the audio is sent as the body (Node wraps the Buffer in a stream)
    assert.ok(init.body != null);
    return jsonResponse({ output: { text: '转写出的文字' } });
  });
  const text = await voice.transcribe(userId, lab.id, audio, 'audio/webm');
  assert.equal(text, '转写出的文字');
  assert.ok(calledUrl.includes('/api/v1/services/asr/recognition'));
});

test('a 401 from DashScope maps to the authentication category', async (t) => {
  const { voice, userId, lab } = setup();
  t.mock.method(globalThis, 'fetch', async () => jsonResponse({ message: 'nope' }, 401));
  await assert.rejects(
    () => voice.synthesize(userId, lab.id, 'hi'),
    (err: unknown) => err instanceof VoiceError && err.category === 'authentication',
  );
});

test('a provider 400 surfaces the real reason (e.g. account arrearage) in the error message', async (t) => {
  const { voice, userId, lab } = setup();
  t.mock.method(globalThis, 'fetch', async () =>
    jsonResponse(
      { code: 'Arrearage', message: 'Access denied, please make sure your account is in good standing.' },
      400,
    ),
  );
  await assert.rejects(
    () => voice.synthesize(userId, lab.id, 'hi'),
    (err: unknown) =>
      err instanceof VoiceError &&
      err.category === 'provider_unavailable' &&
      err.message.includes('Arrearage') &&
      err.message.includes('account is in good standing'),
  );
});

test('a network failure maps to connection_failed', async (t) => {
  const { voice, userId, lab } = setup();
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('ECONNREFUSED');
  });
  await assert.rejects(
    () => voice.synthesize(userId, lab.id, 'hi'),
    (err: unknown) => err instanceof VoiceError && err.category === 'connection_failed',
  );
});
