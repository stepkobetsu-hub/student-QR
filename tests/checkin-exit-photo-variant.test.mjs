import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../tablet_checkin.html', import.meta.url), 'utf8');

test('student exit occasionally uses the supplied photo variant', () => {
  assert.match(page, /PHOTO_EXIT_PROBABILITY = 0\.2/);
  assert.match(page, /type === '退室' && Math\.random\(\) < PHOTO_EXIT_PROBABILITY/);
  assert.match(page, /assets\/checkin\/goodbye-director-night-fast\.webp/);
  assert.match(page, /rel="preload" as="image"[^>]*goodbye-director-night-fast\.webp/);
  assert.match(page, /exitPhotoPreload\.src = PHOTO_EXIT_ASSET/);
  assert.match(page, /photo-variant/);
});

test('entry, duplicate, and teacher screens do not select the photo variant', () => {
  assert.match(page, /!isCooldownDuplicate && type === '退室'/);
  assert.match(page, /resultOverlay\.classList\.remove\('photo-variant'\)/);
});
