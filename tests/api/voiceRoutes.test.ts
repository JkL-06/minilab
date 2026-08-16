import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp } from '../../src/api/app';
import { AgentService } from '../../src/application/agentService';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { LabService } from '../../src/application/labService';
import { MemoryService } from '../../src/application/memoryService';
import { ProjectService } from '../../src/application/projectService';
import { TaskService } from '../../src/application/taskService';
import { VoiceError } from '../../src/domain/errors';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryMemoryRepository } from '../support/inMemoryMemoryRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';
import { testAgentRuntime } from '../support/testAgentRuntime';
import { testAuthDeps } from '../support/testAuth';
import { testDashboardService } from '../support/testDashboardService';
import { testMeetingService } from '../support/testMeetingService';
import { testModelInfra } from '../support/testModelGateway';
import type { TestVoiceService } from '../support/testVoiceService';

/**
 * Voice endpoint tests. `voiceService` is a scripted test double — no network,
 * no DashScope key — so these cover request/response plumbing: audio bytes out
 * of /tts, { text } out of /asr, validation, auth, and error mapping.
 */
function testApp() {
  const labRepo = inMemoryLabRepository();
  const agentRepo = inMemoryAgentRepository();
  const projectRepo = inMemoryProjectRepository();
  const taskRepo = inMemoryTaskRepository();
  const labService = new LabService(labRepo);
  const agentService = new AgentService(agentRepo, labRepo);
  const projectService = new ProjectService(projectRepo, labRepo);
  const taskService = new TaskService(taskRepo, projectRepo, agentRepo, labRepo);
  const infra = testModelInfra(labRepo);
  const { runtime, artifactService, artifacts, runs } = testAgentRuntime({
    agentRepo,
    labRepo,
    projectRepo,
    taskRepo,
    modelConfigService: infra.modelConfigService,
    gateway: infra.gateway,
  });
  const memoryService = new MemoryService(
    inMemoryMemoryRepository(),
    labRepo,
    agentRepo,
    projectRepo,
    new KeywordMemorySearch(),
  );
  const meetingService = testMeetingService({ projectRepo, labRepo, agentRepo, taskRepo, artifacts, taskService, memoryService });
  const dashboardService = testDashboardService({ labRepo, agentRepo, projectRepo, taskRepo, artifacts, runs });
  const auth = testAuthDeps(labRepo);
  const voice = auth.voiceService as TestVoiceService;
  const app = createApp({
    labService,
    agentService,
    projectService,
    taskService,
    modelConfigService: infra.modelConfigService,
    modelGateway: infra.gateway,
    agentRuntime: runtime,
    memoryService,
    artifactService,
    meetingService,
    dashboardService,
    userService: auth.userService,
    sessionStore: auth.sessionStore,
    voiceService: auth.voiceService,
  });
  return { app, labService, userService: auth.userService, voice };
}

const HDR = 'X-User-Id';
const PASSWORD = 'secret123';

function setup(t: ReturnType<typeof testApp>): { userId: string; labId: string } {
  const user = t.userService.createFirstUser({ username: 'jkl', password: PASSWORD });
  const lab = t.labService.createLab(user.id, '语音实验室');
  return { userId: user.id, labId: lab.id };
}

test('POST /api/voice/tts returns synthesized audio with its MIME type', async () => {
  const t = testApp();
  const { userId, labId } = setup(t);
  t.voice.synthesizeResult = { audio: Buffer.from('mp3-bytes'), mime: 'audio/mp3' };
  const res = await request(t.app)
    .post('/api/voice/tts')
    .set(HDR, userId)
    .send({ labId, text: '你好，世界' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'audio/mp3');
  const out = Buffer.isBuffer(res.body) ? res.body : Buffer.from(String(res.body ?? ''), 'binary');
  assert.deepEqual(out, Buffer.from('mp3-bytes'));
  assert.equal(t.voice.calls.length, 1);
  assert.equal(t.voice.calls[0].kind, 'tts');
  assert.equal(t.voice.calls[0].labId, labId);
  assert.equal(t.voice.calls[0].text, '你好，世界');
});

test('POST /api/voice/tts requires text and labId', async () => {
  const t = testApp();
  const { userId, labId } = setup(t);
  const missingText = await request(t.app).post('/api/voice/tts').set(HDR, userId).send({ labId });
  assert.equal(missingText.status, 400);
  const missingLab = await request(t.app).post('/api/voice/tts').set(HDR, userId).send({ text: 'hi' });
  assert.equal(missingLab.status, 400);
  assert.equal(t.voice.calls.length, 0);
});

test('POST /api/voice/asr transcribes a raw audio body', async () => {
  const t = testApp();
  const { userId, labId } = setup(t);
  t.voice.transcribeResult = '转写出的文字';
  const res = await request(t.app)
    .post(`/api/voice/asr?labId=${labId}`)
    .set(HDR, userId)
    .set('Content-Type', 'audio/webm')
    .send(Buffer.from('webm-bytes'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { text: '转写出的文字' });
  assert.equal(t.voice.calls.length, 1);
  assert.equal(t.voice.calls[0].kind, 'asr');
  assert.equal(t.voice.calls[0].audio?.toString(), 'webm-bytes');
});

test('POST /api/voice/asr rejects a missing labId or empty body', async () => {
  const t = testApp();
  const { userId, labId } = setup(t);
  const missingLab = await request(t.app)
    .post('/api/voice/asr')
    .set(HDR, userId)
    .set('Content-Type', 'audio/webm')
    .send(Buffer.from('x'));
  assert.equal(missingLab.status, 400);
  const emptyBody = await request(t.app)
    .post(`/api/voice/asr?labId=${labId}`)
    .set(HDR, userId)
    .set('Content-Type', 'audio/webm')
    .send(Buffer.alloc(0));
  assert.equal(emptyBody.status, 400);
  assert.equal(t.voice.calls.length, 0);
});

test('a VoiceError from the service maps to a stable VOICE_ERROR response', async () => {
  const t = testApp();
  const { userId, labId } = setup(t);
  t.voice.failWith = new VoiceError('authentication', 'DashScope 拒绝了 API Key');
  const res = await request(t.app).post('/api/voice/tts').set(HDR, userId).send({ labId, text: 'hi' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'VOICE_ERROR');
  assert.equal(res.body.error.category, 'authentication');
});

test('voice endpoints require authentication', async () => {
  const t = testApp();
  const res = await request(t.app).post('/api/voice/tts').send({ labId: 'x', text: 'hi' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
});
