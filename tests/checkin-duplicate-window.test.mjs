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
  assert.match(main, /CHECKIN_DUPLICATE_GUARD_V1/);
  assert.match(main, /getSharedDuplicateAttendance_\('student', code, receipt\)/);
  assert.match(main, /rememberSharedDuplicateAttendance_\('student', code, attendance\)/);
  assert.match(main, /duplicateWindowSeconds: CHECKIN_DUPLICATE_WINDOW_MS \/ 1000/);
  assert.match(main, /getLatestTeacherAttendanceFromLog_/);
  assert.match(main, /getSharedDuplicateAttendance_\('teacher', teacher\.code, receipt\)/);
  assert.match(main, /rememberSharedDuplicateAttendance_\('teacher', teacher\.code, attendance\)/);
  assert.match(main, /duplicateFromAuthoritativeLog/);
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
  assert.match(tablet, /name \+ 'は受付済みです'/);
});

test('teacher result reuses the three backgrounds and waves on exit', () => {
  assert.match(tablet, /assets\/checkin\/teacher-arrival\.png/);
  assert.match(tablet, /assets\/checkin\/teacher-goodbye\.png/);
  assert.match(tablet, /assets\/checkin\/teacher-duplicate\.png/);
  assert.match(tablet, /show teacher.*entry|show duplicate teacher/);
  assert.match(tablet, /animation: goodbye-wave 1\.9s/);
  assert.match(tablet, /teacher-exit/);
});

test('latest saved row in 入退室ログ2 is canonical for duplicate timing', () => {
  assert.match(main, /function getLatestStudentAttendanceLog_\(logSheet, code\)/);
  assert.match(main, /const latestSavedAttendance = getLatestStudentAttendanceLog_\(logSheet, code\)/);
  assert.match(main, /const duplicateBaseStampMs = latestSavedAttendance \? latestSavedAttendance\.stampMs : state\.lastStampMs/);
  assert.match(main, /isWithinCheckInDuplicateWindow_\(duplicateBaseStampMs, now\.getTime\(\)\)/);
});

test('tablet separates entry, exit, and duplicate result displays', () => {
  assert.match(tablet, /#resultOverlay\.entry/);
  assert.match(tablet, /#resultOverlay\.exit/);
  assert.match(tablet, /#resultOverlay\.duplicate/);
  assert.match(tablet, /'入室しました'/);
  assert.match(tablet, /'退室しました'/);
  assert.match(tablet, /assets\/checkin\/welcome\.png/);
  assert.match(tablet, /assets\/checkin\/goodbye\.png/);
  assert.match(tablet, /assets\/checkin\/duplicate\.png/);
  assert.doesNotMatch(tablet, /repeating-linear-gradient/);
});
