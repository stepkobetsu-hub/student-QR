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
  assert.match(page, /body\.batch-print \.print-sheet \{[\s\S]*?box-sizing: border-box/);
  assert.match(page, /body\.batch-print \.print-sheet:last-child \{ page-break-after: auto; break-after: auto; \}/);
  assert.match(page, /body\.batch-print \.batch-qr-card \{[\s\S]*?box-sizing: border-box/);
  assert.match(page, /body\.batch-print #appContainer > :not\(\.workspace-shell\)/);
  assert.match(page, /body\.batch-print \.workspace-shell > :not\(#panelCheck\)/);
  assert.match(page, /body\.batch-print #panelCheck \.panel-secondary > :not\(#checkBatchPrintArea\)/);
  assert.match(page, /body\.batch-print #checkBatchPrintArea \{[\s\S]*?position: static !important/);
  assert.match(page, /height: 296mm/);
  assert.match(page, /padding: 22mm 15mm;[\s\S]*?overflow: hidden/);
  assert.match(page, /width: 54mm/);
  assert.match(page, /height: 74mm/);
});

test('QR confirmation menu clearly includes printing', () => {
  assert.match(page, /id="tabCheckBtn"[^>]*>QR確認・印刷<\/button>/);
  assert.match(page, /id="panelCheck" data-title="QR確認・印刷"/);
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

test('new QR issue clearly separates current QR confirmation from replacement', () => {
  assert.match(page, /id="viewCurrentQrBtn"[^>]*>現行QRの確認</);
  assert.match(page, /id="issueBtn"[^>]*>🆕 新規QR発行</);
  assert.match(page, /現行QRが登録されています/);
  assert.match(page, /現行QRはありません/);
  assert.match(page, /登録済みの連絡先/);
  assert.match(page, /function showCurrentQr\(/);
  assert.match(page, /現行QRを新しいQRに変更します/);
  assert.match(page, /新規発行したQR（現在有効）/);
});

test('current QR is shown automatically and notification email has single-student search', () => {
  assert.match(page, /if \(newTabHasExistingQr\) showCurrentQr\(false\)/);
  assert.match(page, /現行QRを印刷する/);
  assert.match(page, /id="emailStudentSearch"/);
  assert.match(page, /生徒コード・氏名・フリガナ・ローマ字で検索/);
  assert.match(page, /function filteredEmailStudents\(\)/);
  assert.match(page, /qrKanaToRomaji\(kana\)/);
  assert.match(page, /function selectEmailStudent\(code\)/);
  assert.match(page, /対象生徒を1人選んでください/);
});

test('email empty results stay hidden and attendance CSV defaults to a selected month', () => {
  assert.match(page, /id="emailStudentSearchList" class="email-student-list hidden"/);
  assert.match(page, /emailStudentSearchListEl\.classList\.add\('hidden'\)/);
  assert.match(page, /id="csvYear"/);
  assert.match(page, /id="csvMonth"/);
  assert.match(page, /function fillCsvDatesFromMonth\(\)/);
  assert.match(page, /new Date\(year, month, 0\)\.getDate\(\)/);
  assert.match(page, /function markCsvCustomRange\(\)/);
  assert.match(page, /classList\.add\('custom-range'\)/);
  assert.match(page, /日付を個別指定中/);
  assert.match(page, /id="csvResetMonthBtn"/);
  assert.match(page, /function resetCsvMonthMode\(\)/);
  assert.match(page, /csvYearEl\.disabled = true/);
  assert.match(page, /csvYearEl\.disabled = false/);
  assert.match(page, /月単位に戻す（年・月を選び直す）/);
});

test('attendance CSV dates show reliable Japanese weekdays', () => {
  assert.match(page, /id="csvStartWeekday"/);
  assert.match(page, /id="csvEndWeekday"/);
  assert.match(page, /function csvDateWithWeekday\(value\)/);
  assert.match(page, /\['日', '月', '火', '水', '木', '金', '土'\]/);
  assert.match(page, /function updateCsvWeekdayDisplays\(\)/);
  assert.match(page, /updateCsvWeekdayDisplays\(\)/);
});
