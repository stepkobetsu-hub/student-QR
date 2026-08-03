import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../tablet_checkin.html', import.meta.url), 'utf8');
const backend = fs.readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');

test('reader uses the active production deployment and not the retired endpoint', () => {
  assert.match(page, /AKfycbw8L36Fj8SKtvNHQBi41FMqAPvDLGAdu1bbLxvd-78A8dFUOkWGnYRE-8PRNq7QZOl70w/);
  assert.doesNotMatch(page, /AKfycbzYpm-16ahuZ3BRFKRT-iSvR9nThsYcTOhxplyBp4bZmVmehfTYZEEl18THzJasypOsTQ/);
});

test('scanner pauses during a request and resumes without restarting the camera', () => {
  assert.match(page, /if \(!scanning \|\| requestInFlight\)/);
  assert.match(page, /scanning = false;[\s\S]*handleQrDetected/);
  assert.match(page, /requestInFlight = false;[\s\S]*scanning = true/);
  assert.equal((page.match(/getUserMedia\(/g) || []).length, 1);
});

test('timeout recovery checks the receipt before retrying with the same id', () => {
  assert.match(page, /action: 'getReceiptStatus', receiptId/);
  assert.match(page, /code === 'RECEIPT_NOT_FOUND'/);
  assert.match(page, /action: 'checkIn', qrData, photoBase64, receiptId/);
  assert.match(page, /SLOW_NOTICE_MS = 8000/);
});

test('server persists receipt id and separates attendance from mail state', () => {
  assert.match(backend, /CHECKIN_RECEIPT_HEADER = '受付ID'/);
  assert.match(backend, /attendanceSaved: true/);
  assert.match(backend, /mailStatus: mailStatus/);
  assert.match(backend, /CHECKIN_MAIL_QUEUE_SHEET = 'メール送信キュー'/);
  assert.match(backend, /processCheckInMailQueue/);
});

test('server uses a bounded lock and one-row writes for attendance', () => {
  assert.match(backend, /tryLock\(3000\)/);
  assert.match(backend, /getRange\(logRow, 1, 1, newRow\.length\)\.setValues/);
  assert.doesNotMatch(backend.slice(backend.indexOf('function handleCheckIn_'), backend.indexOf('function sendEmailViaBrevo')), /UrlFetchApp\.fetch/);
});

test('public errors are distinct', () => {
  for (const code of ['INVALID_QR_FORMAT', 'TARGET_NOT_FOUND', 'SAVE_FAILED', 'TIMEOUT', 'ALREADY_PROCESSED']) {
    assert.match(page + backend, new RegExp(code));
  }
});
