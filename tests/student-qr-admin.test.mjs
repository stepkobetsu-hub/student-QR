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
  assert.match(page, /生徒コード・氏名・フリガナ・ローマ字で検索/);
  assert.match(page, /function qrKanaToRomaji\(value\)/);
  assert.match(page, /selectedQrStudents = new Map\(\)/);
  assert.match(page, /function selectAllVisibleQrStudents\(\)/);
});

test('selected QR cards can be printed together', () => {
  assert.match(page, /id="checkBatchPrintArea"/);
  assert.match(page, /function loadSelectedQrCards\(\)/);
  assert.match(page, /async function printSelectedQrCards\(\)/);
  assert.match(page, /body\.batch-print #checkBatchPrintArea/);
  assert.match(page, /index \+= 9/);
  assert.match(page, /grid-template-columns: repeat\(3, 54mm\)/);
  assert.match(page, /grid-template-rows: repeat\(3, 74mm\)/);
  assert.match(page, /width: 54mm/);
  assert.match(page, /height: 74mm/);
});

test('admin functions use a desktop-first workspace with responsive fallback', () => {
  assert.match(page, /max-width: 1280px/);
  assert.match(page, /class="workspace-shell"/);
  assert.match(page, /grid-template-columns: 220px minmax\(0, 1fr\)/);
  assert.match(page, /class="check-filter-grid"/);
  assert.match(page, /class="email-grid"/);
  assert.match(page, /class="csv-date-grid"/);
  assert.match(page, /@media \(max-width: 900px\)/);
});

test('QR selection mirrors the message-center filtering controls', () => {
  assert.match(page, /id="checkSchoolFilter"/);
  assert.match(page, /id="checkGradeButtons"/);
  assert.match(page, /function clearQrGradeFilters\(\)/);
  assert.match(page, /function setQrSortMode\(mode\)/);
  assert.match(page, /function clearVisibleQrStudents\(\)/);
  assert.match(page, /function invertVisibleQrStudents\(\)/);
  assert.match(page, /現在選択中の生徒/);
});
