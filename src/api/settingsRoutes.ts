import { Router, type NextFunction, type Request, type Response } from 'express';

import type { LabService } from '../application/labService';
import type { ModelConfigService } from '../application/modelConfigService';
import type { ModelGateway } from '../application/modelGateway';
import type { UserService } from '../application/userService';
import type { ModelRequest } from '../domain/model';
import type { ThemeMode } from '../domain/user';
import { AuthenticationError } from '../domain/errors';
import { requireUser } from './auth';
import { renderSettingsPage, type SettingsTab } from './settingsView';

/**
 * Settings center routes (productization layer, outside the SPEC pipeline).
 * Browser-only — HTML GET renders the six-tab page; the POST actions persist
 * profile / prefs / password and share the `/ui/*` flash-redirect pattern.
 */
export interface SettingsRoutesDeps {
  userService: UserService;
  labService: LabService;
  modelConfigService: ModelConfigService;
  modelGateway: ModelGateway;
  dataDir?: string;
  port?: number;
}

const TABS: readonly SettingsTab[] = ['general', 'profile', 'voice', 'config', 'personalize', 'account'];

const TEST_REQUEST: ModelRequest = {
  messages: [{ role: 'user', content: 'Reply with the single word "pong".' }],
};

export function settingsRouter(deps: SettingsRoutesDeps): Router {
  const router = Router();
  router.use(requireUser);
  const { userService, labService, modelConfigService, modelGateway } = deps;

  const wantsHtml = (req: Request): boolean => String(req.header('accept') ?? '').includes('text/html');
  const queryString = (req: Request, key: string): string | null => {
    const v = req.query[key];
    return typeof v === 'string' ? v : null;
  };
  const str = (v: unknown): string => String(v ?? '').trim();
  const toBool = (v: unknown): boolean | undefined => {
    const s = str(v);
    if (s === '1' || s === 'true') return true;
    if (s === '0' || s === 'false') return false;
    return undefined;
  };
  const themeValue = (v: unknown): ThemeMode | undefined => {
    const s = str(v);
    return s === 'light' || s === 'dark' || s === 'system' ? s : undefined;
  };
  const densityValue = (v: unknown): 'compact' | 'comfortable' | undefined => {
    const s = str(v);
    return s === 'compact' || s === 'comfortable' ? s : undefined;
  };
  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : '操作失败');

  const redirectFlash = (
    _req: Request,
    res: Response,
    fallback: string,
    flash: { error?: string; notice?: string },
  ): void => {
    const base = fallback;
    const params = new URLSearchParams();
    if (flash.error) params.set('error', flash.error);
    if (flash.notice) params.set('notice', flash.notice);
    const qs = params.toString();
    const sep = base.includes('?') ? '&' : '?';
    res.redirect(302, qs ? `${base}${sep}${qs}` : base);
  };

  const form =
    (handler: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, _next: NextFunction): void => {
      try {
        Promise.resolve(handler(req, res)).catch((err) => {
          redirectFlash(req, res, '/ui/settings', { error: errorMessage(err) });
        });
      } catch (err) {
        redirectFlash(req, res, '/ui/settings', { error: errorMessage(err) });
      }
    };

  const buildPageData = (req: Request, tab: SettingsTab) => {
    const user = userService.getUser(req.userId);
    const labs = labService.listLabs(req.userId);
    const labsWithConfigs = labs.map((lab) => ({
      lab: { id: lab.id, name: lab.name },
      configs: modelConfigService
        .listModelConfigs(req.userId, lab.id)
        .map((c) => modelConfigService.toView(c)),
    }));
    const dashScopeReady = labsWithConfigs.some((g) =>
      g.configs.some((c) => c.apiKeyConfigured && (c.baseUrl ?? '').includes('dashscope')),
    );
    return {
      user,
      tab,
      error: queryString(req, 'error'),
      notice: queryString(req, 'notice'),
      labsWithConfigs,
      dashScopeReady,
      dataDir: deps.dataDir ?? null,
      port: deps.port ?? null,
    };
  };

  router.get(
    '/ui/settings',
    (req: Request, res: Response, next: NextFunction) => {
      if (!wantsHtml(req)) {
        next();
        return;
      }
      const rawTab = queryString(req, 'tab');
      const tab: SettingsTab = (TABS as readonly string[]).includes(rawTab ?? '')
        ? (rawTab as SettingsTab)
        : 'general';
      try {
        res.type('html').send(renderSettingsPage(buildPageData(req, tab)));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/ui/settings/profile',
    form((req, res) => {
      userService.updateProfile(req.userId, {
        displayName: str(req.body?.displayName) || null,
        avatar: str(req.body?.avatar) || null,
        bio: str(req.body?.bio) || null,
      });
      redirectFlash(req, res, '/ui/settings?tab=profile', { notice: '个人资料已保存' });
    }),
  );

  router.post(
    '/ui/settings/general',
    form((req, res) => {
      userService.updatePreferences(req.userId, {
        general: { language: str(req.body?.language) || undefined, startMinimized: toBool(req.body?.startMinimized) },
      });
      redirectFlash(req, res, '/ui/settings?tab=general', { notice: '常规设置已保存' });
    }),
  );

  router.post(
    '/ui/settings/voice',
    form((req, res) => {
      const speed = Number(req.body?.ttsSpeed);
      userService.updatePreferences(req.userId, {
        voice: {
          enabled: toBool(req.body?.enabled),
          ttsVoice: str(req.body?.ttsVoice) || undefined,
          ttsSpeed: Number.isFinite(speed) && speed >= 0.5 && speed <= 2 ? speed : undefined,
          asrLanguage: str(req.body?.asrLanguage) || undefined,
        },
      });
      redirectFlash(req, res, '/ui/settings?tab=voice', { notice: '语音设置已保存' });
    }),
  );

  router.post(
    '/ui/settings/personalize',
    form((req, res) => {
      userService.updatePreferences(req.userId, {
        personalize: {
          theme: themeValue(req.body?.theme),
          accentColor: str(req.body?.accentColor) || undefined,
          density: densityValue(req.body?.density),
        },
      });
      redirectFlash(req, res, '/ui/settings?tab=personalize', { notice: '外观设置已保存' });
    }),
  );

  router.post(
    '/ui/settings/password',
    form((req, res) => {
      const current = String(req.body?.currentPassword ?? '');
      const next = String(req.body?.newPassword ?? '');
      const confirm = String(req.body?.newPasswordConfirm ?? '');
      if (next !== confirm) {
        redirectFlash(req, res, '/ui/settings?tab=account', { error: '两次输入的新密码不一致' });
        return;
      }
      try {
        userService.changePassword(req.userId, current, next);
        redirectFlash(req, res, '/ui/settings?tab=account', { notice: '密码已修改' });
      } catch (err) {
        if (err instanceof AuthenticationError) {
          redirectFlash(req, res, '/ui/settings?tab=account', { error: '当前密码不正确' });
          return;
        }
        throw err;
      }
    }),
  );

  router.post(
    '/ui/settings/config/test',
    form(async (req, res) => {
      const modelConfigId = str(req.body?.modelConfigId);
      if (!modelConfigId) {
        redirectFlash(req, res, '/ui/settings?tab=config', { error: '缺少模型配置' });
        return;
      }
      const { config, apiKey } = modelConfigService.resolveForGateway(req.userId, modelConfigId);
      const response = await modelGateway.generate(TEST_REQUEST, { config, apiKey });
      redirectFlash(req, res, '/ui/settings?tab=config', {
        notice: `连接成功：${config.provider} / ${response.model} 已返回`,
      });
    }),
  );

  router.post(
    '/ui/settings/logout',
    form((_req, res) => {
      res.redirect(302, '/auth/logout');
    }),
  );

  return router;
}
