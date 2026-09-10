import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tablet = fs.readFileSync(new URL('../tablet_checkin.html', import.meta.url), 'utf8');
const legacy = fs.readFileSync(new URL('../cloudflare/checkin-edge/src/legacy-tablet.html', import.meta.url), 'utf8');
const asset = new URL('../assets/checkin/goodbye-director-daikichi.webp', import.meta.url);

test('大吉・塾長の退室演出を2%で通常タブレットへ追加する', () => {
  assert.equal(fs.existsSync(asset), true);
  assert.match(tablet, /const DAIKICHI_EXIT_PROBABILITY = 0\.02;/);
  assert.match(tablet, /useDaikichiExitVariant = !isCooldownDuplicate && type === '退室'/);
  assert.match(tablet, /classList\.add\('daikichi-variant'\)/);
  assert.match(tablet, /goodbye-director-daikichi\.webp\?v=20260910/);
  assert.match(tablet, /今日もよく頑張りました！ 大吉です！/);
});

test('大吉・塾長の退室演出を2%でFire用画面へ追加する', () => {
  assert.match(legacy, /var DAIKICHI_EXIT_PROBABILITY = 0\.02;/);
  assert.match(legacy, /useDaikichiExitVariant = !duplicate && !isTeacher && type === '退室'/);
  assert.match(legacy, /useDaikichiExitVariant \? ' daikichi-variant'/);
  assert.match(legacy, /goodbye-director-daikichi\.webp\?v=20260910/);
  assert.match(legacy, /今日もよく頑張りました！ 大吉です！/);
});

test('大吉は既存20%のレア抽選後の2%枠とし、重複受付・講師へ出さない', () => {
  const cumulative = /MASCOT_EXIT_PROBABILITY \+ RARE_EXIT_PROBABILITY \+ PHOTO_EXIT_PROBABILITY \+ DAIKICHI_EXIT_PROBABILITY/;
  assert.match(tablet, cumulative);
  assert.match(legacy, cumulative);
  assert.match(legacy, /!duplicate && !isTeacher && type === '退室'/);
});
