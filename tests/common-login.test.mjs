import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../my_qr.html', import.meta.url), 'utf8');
const gas = fs.readFileSync(new URL('../gas/MyQrApi.js', import.meta.url), 'utf8');

test('own QR gets the authenticated common-session student directly without an exchange', () => {
  assert.match(page, /action: 'myQrCommonGet', commonToken: session\.token/);
  assert.match(gas, /action: 'getCommonStudentSession'/);
  assert.match(gas, /const studentId = String\(result && result\.profile && result\.profile\.studentId/);
  assert.doesNotMatch(page, /myQrCommonLogin/);
  assert.doesNotMatch(page, /myQrCommonGet'[^\n]+studentId/);
});

test('direct QR login also establishes the common session without saving a password', () => {
  assert.match(gas, /session\.commonToken = authenticated\.token/);
  assert.match(gas, /Object\.assign\(session, myQrBuildResponse_\(record, session\.expiresAt\)\)/);
  assert.match(page, /saveCommonSession\(result\.commonToken, result\.commonExpiresAt\)/);
  assert.doesNotMatch(page, /localStorage\.setItem\([^\n]*password/i);
});
