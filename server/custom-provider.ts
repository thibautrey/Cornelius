import OpenAI from 'openai';
import type { DatabaseSync } from 'node:sqlite';
import schema from '../schemas/memory-changes.schema.json' with { type: 'json' };
import {
  DEFAULT_CUSTOM_PROVIDER,
  type CustomProviderSettings,
  type CustomProviderView,
} from '../shared/custom-provider.js';
import { strictSchema } from './live/configuration.js';
import { memoryExtractionInstructions } from './memory-extractor.js';
import type { MemoryExtractor } from './memory.js';

export const customProviderMigration = `CREATE TABLE IF NOT EXISTS custom_provider_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Fournisseur personnalisé',
  base_url TEXT NOT NULL DEFAULT '',
  voice_model TEXT NOT NULL DEFAULT '',
  memory_model TEXT NOT NULL DEFAULT '',
  image_model TEXT NOT NULL DEFAULT '',
  voice_fallback TEXT NOT NULL DEFAULT 'openai',
  memory_provider TEXT NOT NULL DEFAULT 'openai',
  memory_fallback TEXT NOT NULL DEFAULT 'openai',
  image_fallback TEXT NOT NULL DEFAULT 'openai'
) STRICT;
INSERT OR IGNORE INTO custom_provider_preferences (id) VALUES (1);`;

export class CustomProviderRepository {
  private models: string[] = [];
  constructor(private readonly db: DatabaseSync) {}

  get(): CustomProviderSettings {
    const row = this.db.prepare('SELECT * FROM custom_provider_preferences WHERE id = 1').get() as
      Record<string, unknown> | undefined;
    if (!row) return { ...DEFAULT_CUSTOM_PROVIDER };
    return {
      name: String(row.name),
      baseUrl: String(row.base_url),
      voiceModel: String(row.voice_model),
      memoryModel: String(row.memory_model),
      imageModel: String(row.image_model),
      voiceFallback: row.voice_fallback === 'mistral' ? 'mistral' : 'openai',
      memoryProvider:
        row.memory_provider === 'custom' || row.memory_provider === 'mistral'
          ? row.memory_provider
          : 'openai',
      memoryFallback: row.memory_fallback === 'mistral' ? 'mistral' : 'openai',
      imageFallback: row.image_fallback === 'local' ? 'local' : 'openai',
    };
  }

  set(value: CustomProviderSettings): void {
    this.db
      .prepare(
        `UPDATE custom_provider_preferences SET
        name = ?, base_url = ?, voice_model = ?, memory_model = ?, image_model = ?,
        voice_fallback = ?, memory_provider = ?, memory_fallback = ?, image_fallback = ? WHERE id = 1`,
      )
      .run(
        value.name.trim(),
        value.baseUrl.replace(/\/+$/u, ''),
        value.voiceModel.trim(),
        value.memoryModel.trim(),
        value.imageModel.trim(),
        value.voiceFallback,
        value.memoryProvider,
        value.memoryFallback,
        value.imageFallback,
      );
  }

  view(keyConfigured: boolean): CustomProviderView {
    const value = this.get();
    return {
      ...value,
      keyConfigured,
      models: this.models,
      ready: {
        voice: keyConfigured && !!value.baseUrl && !!value.voiceModel,
        memory: keyConfigured && !!value.baseUrl && !!value.memoryModel,
        image: keyConfigured && !!value.baseUrl && !!value.imageModel,
      },
    };
  }

  async discover(apiKey: string): Promise<string[]> {
    const config = this.get();
    if (!config.baseUrl) throw new Error('Renseignez d’abord l’URL de base.');
    const client = new OpenAI({ apiKey, baseURL: config.baseUrl, timeout: 12_000, maxRetries: 0 });
    const page = await client.models.list();
    this.models = page.data
      .map((entry) => entry.id)
      .filter(Boolean)
      .sort();
    return this.models;
  }
}

export function createCompatibleMemoryExtractor(
  apiKey: string,
  baseURL: string,
  model: string,
): MemoryExtractor {
  const client = new OpenAI({ apiKey, baseURL, timeout: 55_000, maxRetries: 0 });
  return async (input, signal) => {
    try {
      const response = await client.responses.create(
        {
          model,
          store: false,
          max_output_tokens: 6000,
          instructions: memoryExtractionInstructions,
          input: JSON.stringify(input),
          text: {
            format: {
              type: 'json_schema',
              name: 'memory_changes',
              strict: true,
              schema: strictSchema(schema) as Record<string, unknown>,
            },
          },
        },
        { signal },
      );
      if (response.status === 'completed' && response.output_text)
        return JSON.parse(response.output_text) as unknown;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: memoryExtractionInstructions },
          { role: 'user', content: JSON.stringify(input) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'memory_changes',
            strict: true,
            schema: strictSchema(schema) as Record<string, unknown>,
          },
        },
        max_tokens: 6000,
      },
      { signal },
    );
    const content = completion.choices[0]?.message.content;
    if (!content) throw new Error('Extraction mémoire incomplète.');
    return JSON.parse(content) as unknown;
  };
}

export function withMemoryFallback(primary: MemoryExtractor, fallback: MemoryExtractor | null) {
  if (!fallback) return primary;
  return (async (input, signal) => {
    try {
      return await primary(input, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      return fallback(input, signal);
    }
  }) satisfies MemoryExtractor;
}
