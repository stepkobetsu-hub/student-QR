import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const backend = fs.readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');
const webhook = fs.readFileSync(new URL('../gas/DeliveryFailures.js', import.meta.url), 'utf8');

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
  'checkInRecipientDetail_'
].forEach(name => vm.runInContext(functionSource(name), context));

test('one accepted recipient is counted', () => {
  const recipients = [{email: 'dummy1@example.invalid', status: 'SENT'}];
  assert.equal(context.checkInRecipientSendSummary_(recipients), '送信成功 1/1件');
  assert.equal(context.checkInRecipientDetail_(recipients), 'メール1：送信受付');
});

test('two accepted recipients are counted independently', () => {
  const recipients = [
    {email: 'dummy1@example.invalid', status: 'SENT'},
    {email: 'dummy2@example.invalid', status: 'SENT'}
  ];
  assert.equal(context.checkInRecipientSendSummary_(recipients), '送信成功 2/2件');
  assert.equal(context.checkInRecipientDeliverySummary_(recipients), '送信受付 2/2件');
});

test('one success and one temporary error stay separate', () => {
  const recipients = [
    {email: 'dummy1@example.invalid', status: 'SENT', deliveryEvent: 'delivered'},
    {email: 'dummy2@example.invalid', status: 'FAILED', deliveryEvent: 'soft_bounce'}
  ];
  assert.equal(context.checkInRecipientSendSummary_(recipients), '一部送信 1/2件');
  assert.equal(context.checkInRecipientDetail_(recipients), 'メール1：配信完了 / メール2：一時エラー');
});

test('a permanent bounce does not overwrite the successful recipient', () => {
  const recipients = [
    {email: 'dummy1@example.invalid', status: 'SENT', deliveryEvent: 'delivered'},
    {email: 'dummy2@example.invalid', status: 'SENT', deliveryEvent: 'hard_bounce'}
  ];
  assert.equal(context.checkInRecipientDetail_(recipients), 'メール1：配信完了 / メール2：恒久不達');
  assert.equal(context.checkInRecipientDeliverySummary_(recipients), '一部配信 1/2件');
});

test('up to four queued recipients are shown', () => {
  const recipients = Array.from({length: 4}, (_, i) => ({email: `dummy${i + 1}@example.invalid`, status: 'SENT'}));
  assert.equal(context.checkInRecipientSendSummary_(recipients), '送信成功 4/4件');
  assert.match(context.checkInRecipientDetail_(recipients), /メール4：送信受付$/);
});

test('webhook forwards the matched address and message id for recipient-only update', () => {
  assert.match(webhook, /updateDeliveryLogFromWebhook_\(logRecord, event, eventDate,[\s\S]*?email, messageId\)/);
  assert.match(backend, /recipient\.deliveryEvent = String\(event \|\| ''\)/);
  assert.match(backend, /'送信先別結果'/);
});
