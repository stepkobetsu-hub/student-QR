import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const main = fs.readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');
const tablet = fs.readFileSync(new URL('../tablet_checkin.html', import.meta.url), 'utf8');

test('same student QR is blocked for 60 seconds across locked server requests', () => {
  const context = {};
  vm.runInNewContext(main, context);
  assert.equal(context.isWithinCheckInDuplicateWindow_(100000, 159999), true);
  assert.equal(context.isWithinCheckInDuplicateWindow_(100000, 160000), false);
  assert.equal(context.isWithinCheckInDuplicateWindow_(100000, 160001), false);
  assert.match(main, /const CHECKIN_DUPLICATE_WINDOW_MS = 60 \* 1000/);
  assert.match(main, /const lock = LockService\.getScriptLock\(\)/);
});

test('duplicate result returns before photo and mail queue work', () => {
  const duplicateBranch = main.indexOf('if (attendance.duplicate)');
  const photoWork = main.indexOf('saveCheckInPhoto_(', duplicateBranch);
  const mailWork = main.indexOf('enqueueCheckInMail_(attendance', duplicateBranch);
  assert.ok(duplicateBranch >= 0);
  assert.ok(photoWork > duplicateBranch);
  assert.ok(mailWork > duplicateBranch);
  assert.match(main.slice(duplicateBranch, Math.min(photoWork, mailWork)), /return duplicateResult/);
  assert.match(main, /code: 'DUPLICATE_WITHIN_COOLDOWN'/);
  assert.match(main, /mailStatus: 'NOT_REQUIRED'/);
});

test('tablet explains that duplicate read created no log or email', () => {
  assert.match(tablet, /60秒以内の重複読取のため、記録とメール送信は追加していません/);
  assert.match(tablet, /type \+ 'は受付済みです'/);
});
