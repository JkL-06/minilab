import type { ModelConfigService } from './modelConfigService';
import { VoiceError } from '../domain/errors';

/**
 * Voice service (ASR / TTS) backed by Aliyun DashScope (百炼).
 *
 * Voice reuses the DashScope-compatible model config the user already wired in
 * the 配置 settings tab: the first config whose baseUrl mentions `dashscope` and
 * carries an API key supplies the credential. No new key storage is introduced.
 *
 * Endpoints follow the DashScope native OpenAPI (not the OpenAI-compatible
 * proxy), so the config's `baseUrl` (often `.../compatible-mode/v1`) is reduced
 * to its origin and `/api/v1/services/...` is appended:
 *   - TTS  CosyVoice  POST /api/v1/services/aigc/text2audio/generation
 *   - ASR  Paraformer POST /api/v1/services/asr/recognition   (raw audio body)
 *
 * Responses are parsed defensively (JSON-with-base64-audio or a raw audio
 * stream; `output.text` / `output.audio`) so small contract drift on the
 * provider side degrades to a sanitized `VoiceError` instead of a crash.
 */

export interface VoicePrefs {
  /** CosyVoice speaker name, e.g. 'longxiaochun' (default) / 'longshu'. */
  ttsVoice?: string;
  /** TTS speed multiplier (0.5 – 2.0), clamped. */
  ttsSpeed?: number;
  /** ASR language hint ('zh' | 'en'); DashScope primarily supports zh/en. */
  asrLanguage?: string;
}

export interface SynthesizeResult {
  audio: Buffer;
  /** MIME type of `audio`, e.g. 'audio/mp3' or 'audio/wav'. */
  mime: string;
}

export interface VoiceService {
  synthesize(
    userId: string,
    labId: string,
    text: string,
    prefs?: VoicePrefs,
  ): Promise<SynthesizeResult>;
  transcribe(
    userId: string,
    labId: string,
    audio: Buffer,
    mime: string,
    prefs?: VoicePrefs,
  ): Promise<string>;
}

const DASHSCOPE_FALLBACK = 'https://dashscope.aliyuncs.com';

/** Reduces any DashScope URL to its origin (strips /compatible-mode/v1 etc.). */
function dashScopeRoot(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return DASHSCOPE_FALLBACK;
  }
}

export class DashScopeVoiceService implements VoiceService {
  constructor(
    private readonly modelConfigs: ModelConfigService,
    private readonly timeoutMs = 60_000,
  ) {}

  async synthesize(
    userId: string,
    labId: string,
    text: string,
    prefs?: VoicePrefs,
  ): Promise<SynthesizeResult> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new VoiceError('invalid_request', '没有可朗读的文字');
    }
    if (trimmed.length > 5000) {
      throw new VoiceError('invalid_request', '朗读文字过长（最多 5000 字）');
    }
    const { apiKey, baseUrl } = this.findDashScopeKey(userId, labId);
    const speed = prefs?.ttsSpeed;
    const res = await this.post(
      `${dashScopeRoot(baseUrl)}/api/v1/services/aigc/text2audio/generation`,
      apiKey,
      JSON.stringify({
        model: 'cosyvoice-v2',
        input: { text: trimmed },
        voice: prefs?.ttsVoice ?? 'longxiaochun',
        parameters: {
          format: 'mp3',
          sample_rate: 48000,
          ...(speed != null && speed >= 0.5 && speed <= 2 ? { speed } : {}),
        },
      }),
      'application/json',
    );

    const contentType = String(res.headers.get('content-type') ?? '');
    if (contentType.startsWith('audio/')) {
      // Raw audio stream (some DashScope deployments return the file directly).
      return { audio: Buffer.from(await res.arrayBuffer()), mime: contentType.split(';')[0] };
    }
    const body = await this.readJson(res);
    const base64 = body?.output?.audio;
    if (typeof base64 !== 'string' || base64.length === 0) {
      throw new VoiceError('unknown', '语音合成响应中缺少音频数据');
    }
    return { audio: Buffer.from(base64, 'base64'), mime: 'audio/mp3' };
  }

  async transcribe(
    userId: string,
    labId: string,
    audio: Buffer,
    mime: string,
    _prefs?: VoicePrefs,
  ): Promise<string> {
    if (audio.length === 0) {
      throw new VoiceError('invalid_request', '没有可识别的音频');
    }
    const { apiKey, baseUrl } = this.findDashScopeKey(userId, labId);
    const params = new URLSearchParams({
      model: 'paraformer-realtime-v2',
      format: mime.includes('webm') ? 'wav' : 'wav',
      sample_rate: '16000',
    });
    const res = await this.post(
      `${dashScopeRoot(baseUrl)}/api/v1/services/asr/recognition?${params.toString()}`,
      apiKey,
      audio,
      mime || 'application/octet-stream',
    );
    const body = await this.readJson(res);
    const text = body?.output?.text;
    if (typeof text !== 'string') {
      throw new VoiceError('unknown', '语音识别响应中缺少文字');
    }
    return text;
  }

  /**
   * Finds the user's DashScope credential inside their model configs for this
   * Lab. The credential is decrypted only at call time via `resolveForGateway`.
   */
  private findDashScopeKey(userId: string, labId: string): { apiKey: string; baseUrl: string } {
    const configs = this.modelConfigs.listModelConfigs(userId, labId);
    const dash = configs.find(
      (c) => (c.baseUrl ?? '').toLowerCase().includes('dashscope') && c.apiKeyEncrypted != null,
    );
    if (!dash) {
      throw new VoiceError('invalid_request', '请先在「配置」分区连接 DashScope 模型');
    }
    const { apiKey, config } = this.modelConfigs.resolveForGateway(userId, dash.id);
    if (!apiKey) {
      throw new VoiceError('authentication', 'DashScope 模型未配置 API Key');
    }
    return { apiKey, baseUrl: config.baseUrl ?? DASHSCOPE_FALLBACK };
  }

  private async post(
    url: string,
    apiKey: string,
    body: string | Buffer,
    contentType: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': contentType,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      throw new VoiceError(
        'connection_failed',
        timedOut ? '语音服务请求超时' : '无法连接到语音服务',
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) {
      throw new VoiceError('authentication', await this.errorMessage(res, 'DashScope 拒绝了 API Key'));
    }
    if (res.status === 429) {
      throw new VoiceError('unknown', '语音服务触发限流');
    }
    if (res.status >= 400) {
      throw new VoiceError('provider_unavailable', await this.errorMessage(res, `语音服务返回错误（HTTP ${res.status}）`));
    }
    return res;
  }

  /**
   * 把服务商返回的具体原因附进错误消息（如 DashScope 的
   * `{"code":"Arrearage","message":"Access denied..."}`），否则用户只会看到笼统的
   * "HTTP 400"，无从判断是欠费、模型未开通还是参数问题。body 读取后不可复用，
   * 因此只在错误分支调用。截断到 200 字防大响应刷屏。
   */
  private async errorMessage(res: Response, fallback: string): Promise<string> {
    try {
      const raw = await res.text();
      const data = JSON.parse(raw) as { message?: unknown; code?: unknown };
      const code = typeof data?.code === 'string' && data.code.trim() ? data.code.trim() : '';
      const msg = typeof data?.message === 'string' && data.message.trim() ? data.message.trim() : '';
      const detail = code ? (msg ? `${code} — ${msg}` : code) : msg;
      if (detail) return `${fallback}：${detail.slice(0, 200)}`;
    } catch {
      /* non-JSON body — keep the fallback */
    }
    return fallback;
  }

  private async readJson(res: Response): Promise<Record<string, any>> {
    try {
      const data = (await res.json()) as Record<string, any>;
      return data ?? {};
    } catch {
      throw new VoiceError('unknown', '语音服务返回了无法解析的响应');
    }
  }
}
