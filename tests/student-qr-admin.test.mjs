import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../student_qr_register.html', import.meta.url), 'utf8');

test('admin QR login persists an encrypted device credential and resumes silently', () => {
  assert.match(page, /DEVICE_CREDENTIAL_KEY = 'studentQrDeviceCredentialV1'/);
  assert.match(page, /crypto\.subtle\.encrypt\(\{ name: 'AES-GCM', iv \}/);
  assert.match(page, /return getEncryptedStudentQrCredential\(\)/);
  assert.match(page, /if \(localStorage\.getItem\(EXPLICIT_LOGOUT_KEY\) === '1'\) return null/);
});

test('QR confirmation supports kana and romaji search with multiple selection', () => {
  assert.match(page, /コード番号・氏名・読み仮名・ローマ字で検索/);
  assert.match(page, /function qrKanaToRomaji\(value\)/);
  assert.match(page, /selectedQrStudents = new Map\(\)/);
  assert.match(page, /function selectAllVisibleQrStudents\(\)/);
});

test('selected QR cards can be printed together', () => {
  assert.match(page, /id="checkBatchPrintArea"/);
  assert.match(page, /function loadSelectedQrCards\(\)/);
  assert.match(page, /async function printSelectedQrCards\(\)/);
  assert.match(page, /body\.batch-print #checkBatchPrintArea/);
});
