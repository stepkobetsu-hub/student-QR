import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');

test('optional API modules cannot take down every POST route', () => {
  assert.match(source, /typeof isPointManagerApiAction_ === 'function'/);
  assert.match(source, /typeof handlePointManagerApiAction_ === 'function'/);
  assert.match(source, /POINT_MANAGER_MODULE_MISSING/);
  assert.match(source, /typeof isMyQrApiAction_ === 'function'/);
  assert.match(source, /typeof isBrevoWebhookRequest_ === 'function'/);
  assert.match(source, /typeof isDeliveryFailureAdminAction_ === 'function'/);
});
