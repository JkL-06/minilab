import type { MiniLabDb } from './database';

interface Migration {
  version: number;
  name: string;
  up: string;
}

/**
 * Ordered schema migrations (ENGINEERING_RULES: "Use migrations for schema changes").
 * Each migration runs exactly once inside a transaction and is recorded in
 * `schema_migrations`.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'create_labs',
    up: `
      CREATE TABLE labs (
        id             TEXT PRIMARY KEY,
        owner_user_id  TEXT NOT NULL,
        name           TEXT NOT NULL,
        description    TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      CREATE INDEX idx_labs_owner_user_id ON labs (owner_user_id);
    `,
  },
  {
    version: 2,
    name: 'create_agents',
    up: `
      CREATE TABLE agents (
        id              TEXT PRIMARY KEY,
        lab_id          TEXT NOT NULL REFERENCES labs(id),
        name            TEXT NOT NULL,
        role            TEXT NOT NULL,
        specialization  TEXT,
        profile         TEXT,
        status          TEXT NOT NULL,
        model_config_id TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE INDEX idx_agents_lab_id ON agents (lab_id);
    `,
  },
  {
    version: 3,
    name: 'create_projects',
    up: `
      CREATE TABLE projects (
        id         TEXT PRIMARY KEY,
        lab_id     TEXT NOT NULL REFERENCES labs(id),
        team_id    TEXT,
        title      TEXT NOT NULL,
        objective  TEXT,
        stage      TEXT NOT NULL,
        status     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_projects_lab_id ON projects (lab_id);
    `,
  },
  {
    version: 4,
    name: 'create_tasks',
    up: `
      CREATE TABLE tasks (
        id                TEXT PRIMARY KEY,
        project_id        TEXT NOT NULL REFERENCES projects(id),
        creator_type      TEXT NOT NULL,
        creator_id        TEXT NOT NULL,
        assignee_agent_id TEXT NOT NULL REFERENCES agents(id),
        title             TEXT NOT NULL,
        description       TEXT,
        status            TEXT NOT NULL,
        priority          TEXT NOT NULL,
        due_at            TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE INDEX idx_tasks_project_id ON tasks (project_id);
      CREATE INDEX idx_tasks_assignee_agent_id ON tasks (assignee_agent_id);
    `,
  },
  {
    version: 5,
    name: 'create_model_configs',
    up: `
      CREATE TABLE model_configs (
        id                TEXT PRIMARY KEY,
        lab_id            TEXT NOT NULL REFERENCES labs(id),
        name              TEXT NOT NULL,
        provider          TEXT NOT NULL,
        model             TEXT NOT NULL,
        base_url          TEXT,
        api_key_encrypted TEXT,
        is_enabled        INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE INDEX idx_model_configs_lab_id ON model_configs (lab_id);
    `,
  },
  {
    version: 6,
    name: 'create_agent_runs',
    up: `
      CREATE TABLE agent_runs (
        id                    TEXT PRIMARY KEY,
        lab_id                TEXT NOT NULL REFERENCES labs(id),
        agent_id              TEXT NOT NULL REFERENCES agents(id),
        project_id            TEXT NOT NULL REFERENCES projects(id),
        task_id               TEXT NOT NULL REFERENCES tasks(id),
        model_config_id       TEXT,
        provider              TEXT,
        model                 TEXT,
        status                TEXT NOT NULL,
        error_category        TEXT,
        result_schema_version INTEGER,
        result                TEXT,
        started_at            TEXT NOT NULL,
        ended_at              TEXT NOT NULL,
        created_at            TEXT NOT NULL
      );

      CREATE INDEX idx_agent_runs_agent_id ON agent_runs (agent_id, created_at);
      CREATE INDEX idx_agent_runs_task_id ON agent_runs (task_id);
    `,
  },
  {
    version: 7,
    name: 'create_memories',
    up: `
      CREATE TABLE memories (
        id          TEXT PRIMARY KEY,
        lab_id      TEXT NOT NULL REFERENCES labs(id),
        scope_type  TEXT NOT NULL
                    CHECK (scope_type IN ('agent', 'project', 'team', 'lab')),
        scope_id    TEXT,
        memory_type TEXT NOT NULL DEFAULT 'note',
        content     TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id   TEXT NOT NULL,
        author_type TEXT NOT NULL CHECK (author_type IN ('pi', 'agent')),
        author_id   TEXT NOT NULL,
        importance  INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
        created_at  TEXT NOT NULL,
        CHECK (
          (scope_type = 'lab' AND scope_id IS NULL)
          OR (scope_type IN ('agent', 'project', 'team') AND scope_id IS NOT NULL)
        )
      );

      CREATE INDEX idx_memories_lab_scope ON memories (lab_id, scope_type, scope_id);
    `,
  },
  {
    version: 8,
    name: 'create_artifacts',
    up: `
      CREATE TABLE artifacts (
        id                TEXT PRIMARY KEY,
        project_id        TEXT NOT NULL REFERENCES projects(id),
        task_id           TEXT REFERENCES tasks(id),
        creator_agent_id  TEXT REFERENCES agents(id),
        type              TEXT NOT NULL DEFAULT 'note',
        title             TEXT NOT NULL,
        content           TEXT NOT NULL,
        version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        metadata          TEXT,
        created_at        TEXT NOT NULL
      );

      CREATE INDEX idx_artifacts_project_id ON artifacts (project_id, created_at);
      CREATE INDEX idx_artifacts_task_id ON artifacts (task_id);
    `,
  },
  {
    version: 9,
    name: 'create_meetings',
    up: `
      -- Group Meetings realize DOMAIN_MODEL Event (type 'group_meeting').
      CREATE TABLE meetings (
        id          TEXT PRIMARY KEY,
        lab_id      TEXT NOT NULL REFERENCES labs(id),
        project_id  TEXT NOT NULL REFERENCES projects(id),
        type        TEXT NOT NULL CHECK (type IN ('group_meeting')),
        title       TEXT NOT NULL,
        agenda      TEXT,
        transcript  TEXT,
        status      TEXT NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'completed')),
        started_at  TEXT,
        ended_at    TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE INDEX idx_meetings_project_id ON meetings (project_id, created_at);
      CREATE INDEX idx_meetings_lab_id ON meetings (lab_id);

      -- Participants live in a join table (DOMAIN_MODEL).
      CREATE TABLE meeting_participants (
        meeting_id TEXT NOT NULL REFERENCES meetings(id),
        agent_id   TEXT NOT NULL REFERENCES agents(id),
        PRIMARY KEY (meeting_id, agent_id)
      );

      CREATE INDEX idx_meeting_participants_agent ON meeting_participants (agent_id);

      -- Structured participant updates grounded in tasks/artifacts (SPEC-009 #2).
      CREATE TABLE meeting_updates (
        id           TEXT PRIMARY KEY,
        meeting_id   TEXT NOT NULL REFERENCES meetings(id),
        agent_id     TEXT NOT NULL REFERENCES agents(id),
        content      TEXT NOT NULL,
        task_ids     TEXT NOT NULL,
        artifact_ids TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );

      CREATE INDEX idx_meeting_updates_meeting ON meeting_updates (meeting_id);

      -- Action items; task_id links the follow-up Task (SPEC-009 #4).
      CREATE TABLE action_items (
        id                TEXT PRIMARY KEY,
        meeting_id        TEXT NOT NULL REFERENCES meetings(id),
        project_id        TEXT NOT NULL REFERENCES projects(id),
        title             TEXT NOT NULL,
        assignee_agent_id TEXT REFERENCES agents(id),
        task_id           TEXT REFERENCES tasks(id),
        created_at        TEXT NOT NULL
      );

      CREATE INDEX idx_action_items_meeting ON action_items (meeting_id);

      -- Decisions (DOMAIN_MODEL), meeting-scoped in v0.1.
      CREATE TABLE decisions (
        id            TEXT PRIMARY KEY,
        lab_id        TEXT NOT NULL REFERENCES labs(id),
        project_id    TEXT REFERENCES projects(id),
        meeting_id    TEXT REFERENCES meetings(id),
        made_by_type  TEXT NOT NULL CHECK (made_by_type IN ('pi', 'agent')),
        made_by_id    TEXT NOT NULL,
        statement     TEXT NOT NULL,
        rationale     TEXT,
        created_at    TEXT NOT NULL
      );

      CREATE INDEX idx_decisions_meeting ON decisions (meeting_id);
      CREATE INDEX idx_decisions_project ON decisions (project_id);
    `,
  },
];

export function migrate(db: MiniLabDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    db.transaction(() => {
      db.exec(migration.up);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    })();
  }
}
