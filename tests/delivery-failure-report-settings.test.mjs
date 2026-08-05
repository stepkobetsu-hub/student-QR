import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

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

test('send history keeps all errors plus five successful sends before and after them', () => {
  assert.match(history, /const earliestErrorDate/);
  assert.match(history, /const latestErrorDate/);
  assert.match(history, /const successful = normal\.filter/);
  assert.match(history, /date\.getTime\(\) > latestErrorDate\.getTime\(\)/);
  assert.match(history, /date\.getTime\(\) < earliestErrorDate\.getTime\(\)/);
  assert.match(history, /\}\)\.slice\(0, 5\)\.map/);
  assert.match(history, /readDeliveryFailureItems_\(\)\.filter/);
  assert.match(history, /const items = afterLatest\.concat\(errors, beforeFirst\)/);
  assert.match(backend, /history:getDeliveryAddressHistory_\(item\)/);
  assert.match(page, /最新エラー後の正常送信（最大5件）/);
  assert.match(page, /エラー履歴（すべて）/);
  assert.match(page, /最初のエラー前の正常送信（直前5件）/);
});

test('history behavior returns every error and caps successful sends on both sides at five', () => {
  const headers = ['受付日時', 'メール', '最終配信成功日時', '配信状態', '理由', '件名'];
  const successRow = date => [date, 'family@example.com', date, '配信完了', '', '入室のお知らせ'];
  const rows = [
    ...['2026-07-25T10:00:00+09:00','2026-07-26T10:00:00+09:00','2026-07-27T10:00:00+09:00','2026-07-28T10:00:00+09:00','2026-07-29T10:00:00+09:00','2026-07-30T10:00:00+09:00'].map(successRow),
    ...['2026-08-04T13:00:00+09:00','2026-08-04T14:00:00+09:00','2026-08-04T15:00:00+09:00','2026-08-04T16:00:00+09:00','2026-08-04T17:00:00+09:00','2026-08-04T18:00:00+09:00'].map(successRow)
  ];
  const errors = [
    {id:'e1',email:'family@example.com',event:'deferred',state:'一時エラー',occurredAt:new Date('2026-08-01T09:00:00+09:00'),firstOccurredAt:new Date('2026-08-01T09:00:00+09:00'),lastOccurredAt:new Date('2026-08-01T09:00:00+09:00')},
    {id:'e2',email:'family@example.com',event:'deferred',state:'一時エラー',occurredAt:new Date('2026-08-03T11:00:00+09:00'),firstOccurredAt:new Date('2026-08-03T11:00:00+09:00'),lastOccurredAt:new Date('2026-08-03T11:00:00+09:00')},
    {id:'e3',email:'family@example.com',event:'deferred',state:'一時エラー',occurredAt:new Date('2026-08-04T12:00:00+09:00'),firstOccurredAt:new Date('2026-08-04T12:00:00+09:00'),lastOccurredAt:new Date('2026-08-04T12:00:00+09:00')}
  ];
  const context = {
    normalizeDeliveryFailureHeader_: value => String(value || '').trim(),
    normalizeDeliveryEmail_: value => String(value || '').trim().toLowerCase(),
    Utilities: {formatDate: date => date.toISOString().slice(0, 10)},
    Session: {getScriptTimeZone: () => 'Asia/Tokyo'},
    getDeliveryFailureLogSheet_: () => ({
      getLastRow: () => rows.length + 1,
      getDataRange: () => ({getValues: () => [headers, ...rows]})
    }),
    readDeliveryFailureItems_: () => errors
  };
  vm.runInNewContext(history, context);
  const result = context.getDeliveryAddressHistory_(errors[2]);
  assert.equal(result.errorCount, 3);
  assert.equal(result.afterLatestCount, 5);
  assert.equal(result.beforeFirstCount, 5);
  assert.equal(result.recovered, true);
  assert.deepEqual(Array.from(result.items, item => item.relation), [
    'afterLatestError','afterLatestError','afterLatestError','afterLatestError','afterLatestError',
    'error','error','error',
    'beforeFirstError','beforeFirstError','beforeFirstError','beforeFirstError','beforeFirstError'
  ]);
});
