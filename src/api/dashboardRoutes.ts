import { Router } from 'express';

import type { DashboardService } from '../application/dashboardService';
import type { LabPulseService } from '../application/labPulseService';
import type { LabService } from '../application/labService';
import type { ModelConfigService } from '../application/modelConfigService';
import type { UserService } from '../application/userService';
import { requireUser } from './auth';
import { handle } from './handlers';
import { renderDashboardPage, type DashboardModelConfig } from './dashboardView';
import { renderTodayPage } from './pulseView';
import { BRAND_MARK, THEME_CSS, faviconTag } from './uiTheme';

/**
 * SPEC-010 routes (ADR-0006 #3). The PI Dashboard is the default UI — it tells
 * the PI what is happening in the Lab without an empty-prompt interaction:
 *
 *   GET /labs/:labId/dashboard   the PI dashboard (deep link / fallback). Serves
 *                                the server-rendered HTML page by default
 *                                (browser); returns the same canonical
 *                                `LabDashboard` as JSON when the client sends
 *                                `Accept: application/json`. No LLM call is ever
 *                                made while serving it (acceptance #5).
 *   GET /                        the default home: the Today / Lab Pulse page
 *                                (S1 IA) — cross-lab attention, progress, people
 *                                and today's schedule. A user with no Labs sees
 *                                a one-line "create your first Lab" page (or, in
 *                                desktop mode, an auto-created starter Lab).
 *
 * Acceptance #4 (an Agent is a persistent identity, visually distinct from a
 * temporary chat participant) is realized in the pages: agents are rendered as
 * identity cards with their role/specialization/status, never as chat messages.
 */
export function dashboardRouter(
  dashboardService: DashboardService,
  labService: LabService,
  modelConfigService: ModelConfigService,
  userService: UserService,
  labPulseService: LabPulseService,
): Router {
  const router = Router();

  router.use(requireUser);

  router.get(
    '/',
    handle((req, res) => {
      const labs = labService.listLabs(req.userId);
      if (labs.length === 0 && process.env.MINILAB_DESKTOP === '1') {
        // 桌面版首启：浏览器无法 POST 建 Lab，直接给本地用户建一个起始 Lab，
        // 让「双击 exe → 打开即是 Today / Lab Pulse」（S1 默认首页）成立。
        labService.createLab(req.userId, '我的实验室');
      }
      const pulse = labPulseService.getPulse(req.userId);
      if (pulse.empty) {
        res.type('html').send(renderEmptyLabPage());
        return;
      }
      // Header-authenticated clients (e.g. legacy local-pi scripts) have no
      // user row — their theme falls back to system.
      let theme: string | undefined;
      try {
        theme = userService.getUser(req.userId).preferences.personalize?.theme;
      } catch {
        theme = undefined;
      }
      const error = typeof req.query.error === 'string' ? req.query.error : null;
      const notice = typeof req.query.notice === 'string' ? req.query.notice : null;
      res.type('html').send(renderTodayPage(pulse, { theme, error, notice }));
    }),
  );

  router.get(
    '/labs/:labId/dashboard',
    handle((req, res) => {
      const labId = req.params.labId;
      const dashboard = dashboardService.getLabDashboard(req.userId, labId);
      if (req.accepts(['html', 'json']) === 'html') {
        const modelConfigs: DashboardModelConfig[] = modelConfigService
          .listModelConfigs(req.userId, labId)
          .map((c) => modelConfigService.toView(c));
        const error = typeof req.query.error === 'string' ? req.query.error : null;
        const notice = typeof req.query.notice === 'string' ? req.query.notice : null;
        // Header-authenticated clients (e.g. legacy local-pi scripts) have no
        // user row — their theme falls back to system.
        let theme: string | undefined;
        let voiceEnabled = true;
        try {
          const user = userService.getUser(req.userId);
          theme = user.preferences.personalize?.theme;
          voiceEnabled = user.preferences.voice?.enabled ?? true;
        } catch {
          theme = undefined;
        }
        res
          .type('html')
          .send(renderDashboardPage(dashboard, { modelConfigs, error, notice, theme, voiceEnabled }));
      } else {
        res.json({ dashboard });
      }
    }),
  );

  return router;
}

function renderEmptyLabPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MiniLab · 开始</title>
${faviconTag()}
<style>${THEME_CSS}
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .welcome-card { background: #fff; border: 1px solid #e3e8f1; border-radius: 16px; padding: 2.4rem 2.6rem; max-width: 520px; text-align: center; box-shadow: 0 4px 16px rgba(16,24,40,0.08); }
  .welcome-logo { width: 64px; height: 64px; border-radius: 16px; margin: 0 auto 1rem; display: block; box-shadow: 0 4px 14px rgba(79,70,229,0.35); }
  h1 { margin: 0 0 0.5rem; font-size: 1.4rem; font-weight: 800; }
  code { background: #eef1f6; padding: 0.15rem 0.5rem; border-radius: 6px; font-size: 0.85rem; }
  @media (prefers-color-scheme: dark) {
    .welcome-card { background: #171f33; border-color: #293350; }
    code { background: #222c44; }
  }
</style>
</head>
<body>
<div class="welcome-card">
  ${BRAND_MARK.replace('class="brand-logo"', 'class="brand-logo welcome-logo"')}
  <h1>🏛 欢迎使用 MiniLab</h1>
  <p class="muted">还没有实验室。请先创建一个 Lab，再打开它的 PI Dashboard。</p>
  <p><code>POST /labs  { "name": "你的实验室" }</code></p>
</div>
</body>
</html>`;
}
