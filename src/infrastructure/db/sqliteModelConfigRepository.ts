import type { ModelConfig, ModelProvider } from '../../domain/modelConfig';
import type { ModelConfigRepository } from '../../application/modelConfigRepository';
import type { MiniLabDb } from './database';

interface ModelConfigRow {
  id: string;
  lab_id: string;
  name: string;
  provider: string;
  model: string;
  base_url: string | null;
  api_key_encrypted: string | null;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

function toModelConfig(row: ModelConfigRow): ModelConfig {
  return {
    id: row.id,
    labId: row.lab_id,
    name: row.name,
    provider: row.provider as ModelProvider,
    model: row.model,
    baseUrl: row.base_url,
    apiKeyEncrypted: row.api_key_encrypted,
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(config: ModelConfig): ModelConfigRow {
  return {
    id: config.id,
    lab_id: config.labId,
    name: config.name,
    provider: config.provider,
    model: config.model,
    base_url: config.baseUrl,
    api_key_encrypted: config.apiKeyEncrypted,
    is_enabled: config.isEnabled ? 1 : 0,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
  };
}

/** SQLite-backed ModelConfigRepository. Credentials are stored as ciphertext only. */
export class SqliteModelConfigRepository implements ModelConfigRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(config: ModelConfig): void {
    const row = toRow(config);
    this.db
      .prepare(
        `INSERT INTO model_configs
           (id, lab_id, name, provider, model, base_url, api_key_encrypted, is_enabled, created_at, updated_at)
         VALUES
           (@id, @lab_id, @name, @provider, @model, @base_url, @api_key_encrypted, @is_enabled, @created_at, @updated_at)`,
      )
      .run(row);
  }

  findById(id: string): ModelConfig | null {
    const row = this.db
      .prepare('SELECT * FROM model_configs WHERE id = ?')
      .get(id) as ModelConfigRow | undefined;
    return row ? toModelConfig(row) : null;
  }

  findByLab(labId: string): ModelConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM model_configs WHERE lab_id = ? ORDER BY created_at ASC')
      .all(labId) as ModelConfigRow[];
    return rows.map(toModelConfig);
  }

  update(config: ModelConfig): void {
    const row = toRow(config);
    this.db
      .prepare(
        `UPDATE model_configs
         SET name = @name, provider = @provider, model = @model, base_url = @base_url,
             api_key_encrypted = @api_key_encrypted, is_enabled = @is_enabled, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(row);
  }
}
