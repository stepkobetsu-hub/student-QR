import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const backend = fs.readFileSync(new URL('../gas/DeliveryFailures.js', import.meta.url), 'utf8');
const history = fs.readFileSync(new URL('../gas/DeliveryHistory.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../delivery_failures.html', import.meta.url), 'utf8');

function recoveryContext(entries) {
  const context = {
    Utilities:{formatDate:date => date.toISOString().slice(0, 10)},
    Session:{getScriptTimeZone:() => 'Asia/Tokyo'}
  };
  vm.runInNewContext(backend, context);
  vm.runInNewContext(history, context);
  context.readNormalDeliveryHistoryForEmails_ = emails => Object.fromEntries(emails.map(email => [email, entries]));
  return context;
}

test('temporary failure recovers only after a delivered event for the same student and source', () => {
  const context = recoveryContext([
    {delivered:true,finalAt:new Date('2026-09-10T10:00:00+09:00'),studentId:'7002',studentName:'Sibling',sourceSystem:'QR_ATTENDANCE'},
    {delivered:true,finalAt:new Date('2026-09-11T10:00:00+09:00'),studentId:'7001',studentName:'Target',sourceSystem:'STEP_MESSAGE_CENTER'},
    {delivered:true,finalAt:new Date('2026-09-12T10:00:00+09:00'),studentId:'7001',studentName:'Target',sourceSystem:'QR_ATTENDANCE'}
  ]);
  const failure = {id:'f1',email:'family@example.com',event:'deferred',studentIds:'7001',studentNames:'Target',sourceSystem:'QR_ATTENDANCE',lastOccurredAt:new Date('2026-09-03T10:00:00+09:00'),confirmStatus:'未確認',state:'一時エラー'};
  const [result] = context.annotateDeliveryFailureRecovery_([failure]);
  assert.equal(result.recovered, true);
  assert.equal(new Date(result.recoveredAt).toISOString(), new Date('2026-09-12T10:00:00+09:00').toISOString());
});

test('a sibling delivery on the same email does not recover another student', () => {
  const context = recoveryContext([
    {delivered:true,finalAt:new Date('2026-09-12T10:00:00+09:00'),studentId:'7002',studentName:'Sibling',sourceSystem:'QR_ATTENDANCE'}
  ]);
  const failure = {id:'f1',email:'family@example.com',event:'soft_bounce',studentIds:'7001',studentNames:'Target',sourceSystem:'QR_ATTENDANCE',lastOccurredAt:new Date('2026-09-03T10:00:00+09:00'),confirmStatus:'未確認',state:'一時エラー'};
  const [result] = context.annotateDeliveryFailureRecovery_([failure]);
  assert.equal(result.recovered, false);
});

test('recovered failures are excluded from unresolved list and unconfirmed summary', () => {
  const context = recoveryContext([]);
  const items = [
    {id:'open',event:'deferred',state:'一時エラー',confirmStatus:'未確認',recovered:false,archived:false,studentIds:'',studentNames:'',email:'open@example.com',school:'',sourceSystem:'QR_ATTENDANCE',stopped:true},
    {id:'done',event:'deferred',state:'一時エラー',confirmStatus:'未確認',recovered:true,archived:false,studentIds:'',studentNames:'',email:'done@example.com',school:'',sourceSystem:'QR_ATTENDANCE',stopped:true}
  ];
  assert.deepEqual(Array.from(context.filterDeliveryFailureItems_(items, {resolution:'unresolved'}), item => item.id), ['open']);
  assert.deepEqual(Array.from(context.filterDeliveryFailureItems_(items, {resolution:'recovered'}), item => item.id), ['done']);
  assert.equal(context.deliveryFailureSummary_(items).unconfirmed, 1);
});

test('manager page defaults to unresolved and renders recovered status in green', () => {
  assert.match(page, /id="resolution"/);
  assert.match(page, /value="unresolved" selected>未解決/);
  assert.match(page, /value="recovered">復旧済み/);
  assert.match(page, /recoveredBadge/);
  assert.match(page, /その後配信成功/);
  assert.match(page, /filter\(x=>\$\('includeArchived'\)\.checked\|\|!x\.archived\)/);
});
