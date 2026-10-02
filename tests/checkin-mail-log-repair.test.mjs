import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const backend = fs.readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');

function functionSource(name) {
  const start = backend.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < backend.length; i++) {
    if (backend[i] === '{') { depth++; opened = true; }
    if (backend[i] === '}') depth--;
    if (opened && depth === 0) return backend.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

const context = {};
vm.createContext(context);
[
  'checkInRecipientLabel_',
  'checkInRecipientStateLabel_',
  'checkInRecipientSendSummary_',
  'checkInRecipientDeliverySummary_',
  'checkInRecipientDetail_',
  'checkInLogDeliveryStateIsAuthoritative_',
  'buildCheckInSentLogRepair_',
  'checkInSentLogRepairNeeded_'
].forEach(name => vm.runInContext(functionSource(name), context));

function sentQueueRow() {
  const row = Array(17).fill('');
  row[0] = 'qr-edge-existing-receipt';
  row[3] = 'SENT';
  row[10] = JSON.stringify([{
    email: 'guardian@example.invalid',
    status: 'SENT',
    messageId: '<message@example.invalid>',
    correlationId: 'correlation-1',
    provider: 'BREVO'
  }]);
  return row;
}

test('SENT queue data produces a log-only repair payload', () => {
  const repair = context.buildCheckInSentLogRepair_(sentQueueRow());
  assert.equal(repair.ok, true);
  assert.equal(repair.status, '送信成功 1/1件');
  assert.deepEqual(Array.from(repair.messageIds), ['<message@example.invalid>']);
  assert.deepEqual(Array.from(repair.correlationIds), ['correlation-1']);
  assert.equal(repair.provider, 'BREVO');
});

test('invalid or incomplete SENT data is not repaired', () => {
  const invalid = sentQueueRow();
  invalid[10] = '{';
  assert.equal(context.buildCheckInSentLogRepair_(invalid).code, 'RECIPIENTS_INVALID');
  const incomplete = sentQueueRow();
  incomplete[10] = JSON.stringify([{status: 'FAILED'}]);
  assert.equal(context.buildCheckInSentLogRepair_(incomplete).code, 'QUEUE_SENT_RECIPIENT_MISMATCH');
  assert.match(backend, /LOG_NOT_FOUND/);
});

test('repair detects stale send fields and is idempotent once aligned', () => {
  const repair = context.buildCheckInSentLogRepair_(sentQueueRow());
  const headers = ['メール送信結果','BrevoメッセージID','照合ID','メール送信方式','配信状態'];
  const stale = ['送信待ち','[]','[]','','送信待ち'];
  assert.equal(context.checkInSentLogRepairNeeded_(stale, headers, repair), true);
  const aligned = [repair.status, JSON.stringify(repair.messageIds), JSON.stringify(repair.correlationIds), repair.provider, '送信受付 1/1件'];
  assert.equal(context.checkInSentLogRepairNeeded_(aligned, headers, repair), false);
});

test('newer webhook delivery states are authoritative', () => {
  for (const state of ['配信完了','送信受付 1/1件','一時エラー','恒久不達','ブロック']) {
    assert.equal(context.checkInLogDeliveryStateIsAuthoritative_(state), true);
  }
  assert.equal(context.checkInLogDeliveryStateIsAuthoritative_('送信待ち'), false);
  assert.equal(context.checkInLogDeliveryStateIsAuthoritative_('送信中'), false);
  assert.match(functionSource('updateCheckInLogMailStatus_'), /preserveAuthoritativeDeliveryState/);
});

test('repair path cannot resend mail or overwrite the full log row', () => {
  const repairSource = [
    functionSource('repairCheckInSentLogFromQueueRow_'),
    functionSource('repairRecentCheckInSentLogStatuses_'),
    functionSource('repairCheckInMailLogStatuses')
  ].join('\n');
  assert.doesNotMatch(repairSource, /sendCheckInEmail_|MailApp\.sendEmail|UrlFetchApp\.fetch/);
  const updateSource = functionSource('updateCheckInLogMailStatus_');
  assert.match(updateSource, /getRange\(target\.row, index \+ 1\)\.setValue/);
  assert.doesNotMatch(updateSource, /setValues\(\[values\]\)/);
});

test('normal worker and receipt-specific processing both self-heal SENT logs', () => {
  assert.match(functionSource('processCheckInMailQueue'), /repairRecentCheckInSentLogStatuses_/);
  assert.match(functionSource('processCheckInMailQueueReceipt_'), /status === 'SENT'[\s\S]*repairCheckInSentLogFromQueueRow_/);
});

test('one writeback exception is reported without stopping later repairs', () => {
  const rows = [sentQueueRow(), sentQueueRow()];
  rows[1][0] = 'qr-edge-second-receipt';
  let calls = 0;
  const repairContext = {
    CHECKIN_MAIL_QUEUE_HEADERS: Array(17).fill(''),
    getCheckInLogTargets_: () => [],
    indexCheckInLogTargets_: targets => targets,
    repairCheckInSentLogFromQueueRow_: () => {
      calls++;
      if (calls === 1) throw new Error('writeback failed');
      return {repaired: 1, code: 'REPAIRED'};
    },
    sanitizeCheckInError_: error => error.message,
    console: {error() {}}
  };
  vm.createContext(repairContext);
  vm.runInContext(functionSource('repairRecentCheckInSentLogStatuses_'), repairContext);
  const sheet = {
    getLastRow: () => 3,
    getRange: () => ({getValues: () => rows})
  };
  const result = repairContext.repairRecentCheckInSentLogStatuses_(sheet, 2, 3);
  assert.equal(result.scanned, 2);
  assert.equal(result.repaired, 1);
  assert.equal(result.unresolved, 1);
});
