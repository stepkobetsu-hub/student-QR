import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tablet = fs.readFileSync(new URL('../tablet_checkin.html', import.meta.url), 'utf8');
const legacy = fs.readFileSync(new URL('../cloudflare/checkin-edge/src/legacy-tablet.html', import.meta.url), 'utf8');
const assets = ['daikichi', 'chukichi', 'shokichi'].map((kind) =>
  new URL(`../assets/checkin/goodbye-director-${kind}.webp`, import.meta.url)
);

test('おみくじ3種を各2%で通常タブレットへ追加する', () => {
  for (const asset of assets) assert.equal(fs.existsSync(asset), true);
  assert.match(tablet, /const DAIKICHI_EXIT_PROBABILITY = 0\.02;/);
  assert.match(tablet, /const CHUKICHI_EXIT_PROBABILITY = 0\.02;/);
  assert.match(tablet, /const SHOKICHI_EXIT_PROBABILITY = 0\.02;/);
  assert.match(tablet, /useDaikichiExitVariant = !isCooldownDuplicate && type === '退室'/);
  assert.match(tablet, /useChukichiExitVariant = !isCooldownDuplicate && type === '退室'/);
  assert.match(tablet, /useShokichiExitVariant = !isCooldownDuplicate && type === '退室'/);
  assert.match(tablet, /classList\.add\('daikichi-variant'\)/);
  assert.match(tablet, /classList\.add\('chukichi-variant'\)/);
  assert.match(tablet, /classList\.add\('shokichi-variant'\)/);
});

test('おみくじ3種を各2%でFire用画面へ追加する', () => {
  assert.match(legacy, /var DAIKICHI_EXIT_PROBABILITY = 0\.02;/);
  assert.match(legacy, /var CHUKICHI_EXIT_PROBABILITY = 0\.02;/);
  assert.match(legacy, /var SHOKICHI_EXIT_PROBABILITY = 0\.02;/);
  assert.match(legacy, /useDaikichiExitVariant = !duplicate && !isTeacher && type === '退室'/);
  assert.match(legacy, /useChukichiExitVariant = !duplicate && !isTeacher && type === '退室'/);
  assert.match(legacy, /useShokichiExitVariant = !duplicate && !isTeacher && type === '退室'/);
});

test('本番では既存演出を復活し、おみくじ3種合計6%・通常74%とする', () => {
  assert.match(tablet, /const PHOTO_EXIT_PROBABILITY = 0\.10;/);
  assert.match(tablet, /const RARE_EXIT_PROBABILITY = 0\.05;/);
  assert.match(tablet, /const MASCOT_EXIT_PROBABILITY = 0\.05;/);
  const cumulative = /DAIKICHI_EXIT_PROBABILITY \+ CHUKICHI_EXIT_PROBABILITY \+ SHOKICHI_EXIT_PROBABILITY/;
  assert.match(tablet, cumulative);
  assert.match(legacy, cumulative);
  assert.match(legacy, /!duplicate && !isTeacher && type === '退室'/);
});
