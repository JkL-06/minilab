import express, { Router } from 'express';

import type { UserService } from '../application/userService';
import type { VoicePrefs, VoiceService } from '../application/voiceService';
import { requireUser } from './auth';
import { handle } from './handlers';

/**
 * Voice endpoints (productization layer). The dashboard's 🎤/🔊 entries call
 * these; the DashScope credential is resolved server-side from the user's model
 * configs (see VoiceService), so the browser never touches an API key.
 *
 *   POST /api/voice/tts         JSON { text, labId } → audio bytes
 *   POST /api/voice/asr?labId=  raw audio body (audio/* or octet-stream) → { text }
 *
 * The ASR route parses the audio body locally via `express.raw`; the client
 * (MediaRecorder) sends the recorded Blob with its real MIME type.
 */
export interface VoiceRoutesDeps {
  voiceService: VoiceService;
  userService: UserService;
}

export function voiceRouter({ voiceService, userService }: VoiceRoutesDeps): Router {
  const router = Router();
  router.use(requireUser);

  /** Voice preferences from the settings tab; header-authenticated clients
   *  (no user row) fall back to defaults. */
  const prefsOf = (userId: string): VoicePrefs => {
    try {
      const voice = userService.getUser(userId).preferences.voice ?? {};
      return { ttsVoice: voice.ttsVoice, ttsSpeed: voice.ttsSpeed, asrLanguage: voice.asrLanguage };
    } catch {
      return {};
    }
  };

  router.post(
    '/api/voice/tts',
    handle(async (req, res) => {
      const labId = String((req.body as { labId?: unknown } | undefined)?.labId ?? '').trim();
      const text = String((req.body as { text?: unknown } | undefined)?.text ?? '').trim();
      if (!labId || !text) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'text 和 labId 不能为空' } });
        return;
      }
      const result = await voiceService.synthesize(req.userId, labId, text, prefsOf(req.userId));
      res.type(result.mime).send(result.audio);
    }),
  );

  router.post(
    '/api/voice/asr',
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }),
    handle(async (req, res) => {
      const labId = String(req.query.labId ?? '').trim();
      if (!labId) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '缺少 labId' } });
        return;
      }
      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.length === 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '缺少音频数据' } });
        return;
      }
      const mime = String(req.header('content-type') ?? 'application/octet-stream');
      const text = await voiceService.transcribe(req.userId, labId, audio, mime, prefsOf(req.userId));
      res.json({ text });
    }),
  );

  return router;
}
