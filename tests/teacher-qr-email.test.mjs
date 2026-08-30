import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../teacher_qr_create.html', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');

test('teacher email is returned from column P by the QR backend', () => {
  assert.match(backend, /const TEACHER_COL_EMAIL = 16/);
  assert.match(backend, /getRange\(teacherRow, TEACHER_COL_EMAIL\)\.getDisplayValue\(\)/);
  assert.match(backend, /email: email,[\s\S]*teacherEmail: email,[\s\S]*emailChecked: true/);
  assert.match(backend, /emailSource: '講師マスターP列'/);
});

test('teacher QR page trusts the production QR API and has no portal fallback', () => {
  assert.match(page, /String\(r\.email\|\|r\.teacherEmail\|\|''\)\.trim\(\)/);
  assert.match(page, /if\(!r\.emailChecked&&!email\)/);
  assert.doesNotMatch(page, /TEACHER_INFO_API|teacherInfoJsonp|action:'getTeacher'/);
  assert.match(page, /メールアドレス未登録/);
  assert.match(page, /color:#d93025/);
});

test('teacher QR display, issuance and printing hooks remain wired', () => {
  assert.match(page, /function showQR\(notice\)/);
  assert.match(page, /action:'issueNewQr'/);
  assert.match(page, /\$\('print'\)\.addEventListener\('click',\(\)=>window\.print\(\)\)/);
  assert.match(page, /qrImg/);
  assert.match(page, /api\.qrserver\.com\/v1\/create-qr-code/);
});

test('teacher QR inline script parses', () => {
  const source = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(source);
  assert.doesNotThrow(() => new Function(source));
});
