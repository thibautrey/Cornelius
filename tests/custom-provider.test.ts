import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { CustomProviderRepository } from '../server/custom-provider.js';
import { openDatabase } from '../server/storage.js';
import { DEFAULT_CUSTOM_PROVIDER, validCustomProviderSettings } from '../shared/custom-provider.js';

test('configuration personnalisée validée, persistée et expurgée', () => {
  const db = openDatabase(':memory:');
  const repository = new CustomProviderRepository(db);
  const settings = {
    ...DEFAULT_CUSTOM_PROVIDER,
    name: 'Mon serveur',
    baseUrl: 'http://127.0.0.1:11434/v1/',
    voiceModel: 'voice-local',
    memoryModel: 'chat-local',
    imageModel: 'image-local',
    memoryProvider: 'custom' as const,
  };
  assert.equal(validCustomProviderSettings(settings), true);
  repository.set(settings);
  assert.equal(repository.get().baseUrl, 'http://127.0.0.1:11434/v1');
  assert.deepEqual(repository.view(true).ready, { voice: true, memory: true, image: true });
  assert.equal(
    validCustomProviderSettings({ ...settings, baseUrl: 'https://user:secret@example.test/v1' }),
    false,
  );
  db.close();
});

test('les modèles sont découverts par l’endpoint compatible sans exposer la clé', async (t) => {
  let authorization = '';
  const server = createServer((request, response) => {
    authorization = String(request.headers.authorization ?? '');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'z-model' }, { id: 'a-model' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const repository = new CustomProviderRepository(db);
  repository.set({
    ...DEFAULT_CUSTOM_PROVIDER,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  assert.deepEqual(await repository.discover('custom-secret-value'), ['a-model', 'z-model']);
  assert.equal(authorization, 'Bearer custom-secret-value');
  assert.equal(JSON.stringify(repository.view(true)).includes('custom-secret-value'), false);
});
