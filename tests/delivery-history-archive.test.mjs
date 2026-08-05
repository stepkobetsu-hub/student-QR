import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const archive = fs.readFileSync(new URL('../gas/DeliveryArchive.js', import.meta.url), 'utf8');
const history = fs.readFileSync(new URL('../gas/DeliveryHistory.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');

test('retention is a rolling two years and archives are separated by year', () => {
  const context = {
    Utilities:{formatDate:date => String(date.getFullYear()), DigestAlgorithm:{SHA_256:'SHA_256'}, Charset:{UTF_8:'UTF_8'}},
    Session:{getScriptTimeZone:() => 'Asia/Tokyo'}
  };
  vm.runInNewContext(archive, context);
  const cutoff = context.deliveryHistoryArchiveCutoff_(new Date('2026-08-05T12:00:00+09:00'));
  assert.equal(cutoff.getFullYear(), 2024);
  assert.equal(cutoff.getMonth(), 7);
  assert.equal(cutoff.getDate(), 5);
  assert.equal(context.deliveryHistoryArchiveYear_(new Date('2023-12-31T12:00:00+09:00')), 2023);
});

test('automatic archive uses a supported daily trigger with a monthly throttle', () => {
  assert.match(archive, /archiveOldDeliveryHistoryScheduled/);
  assert.match(archive, /everyDays\(1\)\.atHour\(3\)/);
  assert.match(archive, /DELIVERY_HISTORY_ARCHIVE_CHECK_INTERVAL_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
});

test('archive copies, verifies and only then deletes source rows', () => {
  const flush = archive.indexOf('SpreadsheetApp.flush()');
  const confirmed = archive.indexOf('const confirmedKeys', flush);
  const deletion = archive.indexOf('deliveryHistoryDeleteRows_', confirmed);
  assert.ok(flush >= 0 && confirmed > flush && deletion > confirmed);
  assert.match(archive, /保管元行キー/);
  assert.match(archive, /Utilities\.computeDigest/);
});

test('send history searches active and archived log and queue sheets', () => {
  assert.match(history, /getDeliveryHistorySourceSheets_\('メール送信キュー'\)/);
  assert.match(history, /getDeliveryHistorySourceSheets_\('ログ'\)/);
  assert.match(archive, /function getDeliveryHistorySourceSheets_/);
  assert.match(archive, /DELIVERY_HISTORY_ARCHIVE_INDEX/);
});
