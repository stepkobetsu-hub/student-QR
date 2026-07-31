import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../my_qr.html', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../gas/MyQrApi.js', import.meta.url), 'utf8');
const gas = fs.readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../gas/README.md', import.meta.url), 'utf8');
const staffPage = fs.readFileSync(new URL('../student_qr_register.html', import.meta.url), 'utf8');

test('new public files contain no production identifiers or concrete authentication columns', () => {
  const publicChanges = [page, api, readme].join('\n');
  assert.doesNotMatch(publicChanges, /script\.google\.com\/macros\/s\//);
  assert.doesNotMatch(publicChanges, /AKfy[a-zA-Z0-9_-]+/);
  assert.doesNotMatch(publicChanges, /docs\.google\.com\/spreadsheets\/d\//);
  assert.doesNotMatch(readme, /[A-Z]{1,2}列/);
});

test('client stores only a token and expiry, never password or student id', () => {
  assert.match(page, /TOKEN_KEY = 'stepMyQrSessionToken'/);
  assert.match(page, /EXPIRES_KEY = 'stepMyQrSessionExpiresAt'/);
  assert.doesNotMatch(page, /localStorage\.setItem\([^\n]*(password|studentId)/i);
  assert.match(page, /\$\('password'\)\.value = ''/);
  assert.match(page, /\$\('studentId'\)\.value = ''/);
});

test('own-QR request sends a token only', () => {
  assert.match(page, /api\(\{ action: 'myQrGet', token: session\.token \}\)/);
  assert.doesNotMatch(page, /action: 'myQrGet'[^\n]*studentId/);
});

test('backend derives the student from the verified session', () => {
  assert.match(api, /const session = myQrRequireSession_\(body\.token\)/);
  assert.match(api, /myQrFindStudent_\(session\.studentId\)/);
  assert.match(api, /body\.studentId等は意図的に参照しない/);
});

test('backend exposes no arbitrary student lookup action', () => {
  assert.doesNotMatch(api, /myQrGet[^\n]*studentId/);
  assert.match(gas, /requireQrStaffSession_\(params\)/);
  assert.match(gas, /isMyQrApiAction_\(body\.action\)/);
});

test('staff QR page remains present and unchanged in purpose', () => {
  assert.match(staffPage, /QR_ALLOWED_PERMISSION_LEVELS = \['2', '3', '4'\]/);
  assert.match(staffPage, /既存QR登録/);
  assert.match(staffPage, /新規QR発行/);
});
