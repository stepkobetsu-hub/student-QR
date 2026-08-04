import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../delivery_failures.html', import.meta.url), 'utf8');
const backend = fs.readFileSync(new URL('../gas/DeliveryFailures.js', import.meta.url), 'utf8');
const history = fs.readFileSync(new URL('../gas/DeliveryHistory.js', import.meta.url), 'utf8');

test('report settings support one to four private recipients', () => {
  assert.match(backend, /DELIVERY_FAILURE_REPORT_EMAILS_PROPERTY = 'DELIVERY_FAILURE_REPORT_EMAILS'/);
  assert.match(backend, /DELIVERY_FAILURE_REPORT_MAX_RECIPIENTS = 4/);
  assert.match(backend, /deliveryFailureReportSettingsGet/);
  assert.match(backend, /deliveryFailureReportSettingsSave/);
  assert.match(backend, /verifyDeliveryStaff_\(body, \['2','3','4'\]\)/);
  assert.match(backend, /報告先メールアドレスを1件以上入力してください/);
});

test('every new failure is reported once to each configured recipient', () => {
  const start = backend.indexOf('function notifyDeliveryFailureAdministratorSafely_');
  const end = backend.indexOf('function updateDeliveryLogFromWebhook_', start);
  const source = backend.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source, /isMajorDeliveryFailure_/);
  assert.match(source, /String\(notifiedValue\)===notificationKey/);
  assert.match(source, /reportEmails\.forEach/);
  assert.match(source, /MailApp\.sendEmail\(\{to:recipient,subject:subject,body:body\}\)/);
});

test('page exposes a manager-only report settings dialog with four inputs', () => {
  assert.match(page, /id="reportSettingsButton"[^>]*>報告メール設定</);
  assert.match(page, /id="reportSettingsDialog"/);
  for (let i = 1; i <= 4; i++) assert.match(page, new RegExp(`id="reportEmail${i}"`));
  assert.match(page, /deliveryFailureReportSettingsGet/);
  assert.match(page, /deliveryFailureReportSettingsSave/);
  assert.match(page, /\['2','3','4'\]\.includes/);
});

test('default recipient is not exposed in public source', () => {
  assert.doesNotMatch(page + backend + history, /mintcocoajasmine@gmail\.com/i);
});

test('send history keeps error day, prior five sends, and all historical errors', () => {
  assert.match(history, /deliveryHistoryDayKey_\(entry\.occurredAt\) === anchorDay/);
  assert.match(history, /deliveryHistoryDayKey_\(entry\.occurredAt\) < anchorDay; \}\)\.slice\(0, 5\)/);
  assert.match(history, /readDeliveryFailureItems_\(\)\.filter/);
  assert.match(backend, /history:getDeliveryAddressHistory_\(item\)/);
});
