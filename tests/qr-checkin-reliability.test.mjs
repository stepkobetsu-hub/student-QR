import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

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

test('rear-camera preview is corrected without mirroring analysis or mail photo canvases', () => {
  assert.match(page, /video \{[\s\S]*transform: scaleX\(-1\)/);
  assert.match(page, /ctx\.drawImage\(video, 0, 0, canvas\.width, canvas\.height\)/);
  assert.match(page, /photoCtx\.drawImage\(video, 0, 0, photoCanvas\.width, photoCanvas\.height\)/);
  assert.doesNotMatch(page, /ctx\.scale\(-1/);
  assert.doesNotMatch(page, /photoCtx\.scale\(-1/);
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
  assert.match(backend, /getScriptLock\(\)[\s\S]*tryLock\(100\)/);
  assert.match(backend, /getCheckInMailConfigStatus_\(\)/);
  assert.match(backend, /BREVO_API_KEY_MISSING/);
  assert.match(backend, /CHECKIN_MAIL_DIAGNOSTIC_MODE/);
  assert.match(backend, /provider: 'DIAGNOSTIC'/);
  assert.match(backend, /runCheckInMailDummyDiagnostics/);
  assert.match(backend, /MAIL_QUEUE_NOT_IDLE/);
  assert.match(backend, /provider: 'MAILAPP_FALLBACK'/);
  assert.match(backend, /MailApp\.sendEmail/);
  assert.match(backend, /mailAppAttemptedAt/);
  assert.match(backend, /mailAppStartedAt/);
  assert.match(backend, /mailAppCompletedAt/);
  assert.match(backend, /CHECKIN_PHOTO_CACHE_PREFIX/);
  assert.match(backend, /CacheService\.getScriptCache\(\)\.put\(cacheKey, raw, 600\)/);
  assert.doesNotMatch(backend, /const immediate = processCheckInMailQueueReceipt_\(receipt, 3000\)/);
  assert.doesNotMatch(backend, /cached\.mailStatus === 'PENDING'[\s\S]*processCheckInMailQueueReceipt_\(receipt, 3000\)/);
  assert.match(backend, /ensureCheckInMailWorkerTrigger_/);
  assert.match(backend, /MAIL_WORKER_TRIGGER_CHECK_FAILED/);
  assert.match(backend, /try \{[\s\S]*ensureCheckInMailWorkerTrigger_\(\);[\s\S]*\} catch \(error\)/);
  assert.match(page, /trackMailCompletionInBackground\(receiptId\)/);
  assert.match(page, /void waitForMailCompletion\(receiptId, 7000\)/);
  assert.doesNotMatch(page, /await waitForMailCompletion\(receiptId/);
  assert.match(page, /SCAN_RELEASE_MS = 300/);
  assert.match(page, /DUPLICATE_RESUME_MS = 1000/);
  assert.match(page, /setTimeout\(\(\) => releaseScannerForNextPerson\(scanToken\), SCAN_RELEASE_MS\)/);
  assert.match(page, /isCurrentScanFeedback\(scanToken, feedbackDeadline\)/);
  assert.doesNotMatch(page, /finishAndResume\(resumeDelayMs\)/);
  assert.match(page, /受付が完了しました。次のQRを読み取れます/);
  assert.match(page, /MailApp一時送信/);
  assert.match(backend, /sendApprovedMailAppFallbackTestToConfiguredSender/);
  assert.match(backend, /CHECKIN_MAILAPP_APPROVED_TEST_ATTEMPTED_AT/);
  assert.match(page, /入退室記録は完了しましたが、通知メールの送信に失敗しました/);
  assert.match(backend, /subjectId: code/);
  assert.match(backend, /attendance\.subjectId \|\| ''/);
  assert.match(backend, /findPriorQueuedMailWithinDuplicateWindow_/);
  assert.match(backend, /SKIPPED_DUPLICATE/);
  assert.match(backend, /重複のため送信省略/);
  assert.match(backend, /notifyCheckInProcessingFailureSafely_/);
  assert.match(backend, /getDeliveryFailureReportEmails_/);
});

test('tablet sends a smaller photo and mail remains fully queued', () => {
  assert.match(page, /360 \/ video\.videoWidth/);
  assert.match(page, /toDataURL\('image\/jpeg', 0\.35\)/);
  assert.match(backend, /送信は1分間隔のワーカーへ任せ/);
  assert.match(backend, /everyMinutes\(1\)/);
});

test('teacher notifications use column P and a versioned cache record', () => {
  assert.match(backend, /TEACHER_COL_EMAIL = 16/);
  assert.match(backend, /TEACHER_COL_EMAIL - 1/);
  assert.match(backend, /TEACHER_INDEX_CACHE_VERSION = 'v43-email-p15'/);
  assert.match(backend, /findTeacherByQrCached_/);
  assert.match(backend, /email: String\(values\[TEACHER_COL_EMAIL - 1\]/);
  assert.match(backend, /cache\.remove\('CHECKIN_QR_ROW_V1:teacher:'/);
  assert.match(backend, /notifyEmails = \[teacherEmailStateBeforeLock\.email\]/);
});

test('teacher mail errors are distinct and attendance remains successful', () => {
  for (const code of ['TEACHER_NOT_FOUND', 'TEACHER_EMAIL_EMPTY', 'TEACHER_EMAIL_INVALID', 'NOTIFICATION_CONFIG_ERROR', 'BREVO_NOT_CONFIGURED', 'BREVO_API_KEY_MISSING', 'MAIL_QUEUE_CREATE_FAILED', 'MAIL_WORKER_NOT_RUNNING', 'BREVO_AUTH_FAILED', 'BREVO_SEND_REJECTED', 'SENDER_CONFIG_INVALID', 'RECIPIENT_INVALID', 'PHOTO_PROCESS_FAILED', 'BREVO_API_TIMEOUT', 'BREVO_SEND_FAILED']) {
    assert.match(page + backend, new RegExp(code));
  }
  assert.match(backend, /attendanceSaved: true/);
  assert.match(backend, /markCheckInMailQueueFailed_/);
  assert.match(backend, /getTeacherLogSheet_\(\)[\s\S]*updateCheckInLogMailStatus_/);
});

test('server uses a bounded lock and one-row writes for attendance', () => {
  assert.match(backend, /tryLock\(5000\)/);
  assert.match(backend, /getRange\(logRow, 1, 1, newRow\.length\)\.setValues/);
  assert.doesNotMatch(backend.slice(backend.indexOf('function handleCheckIn_'), backend.indexOf('function sendEmailViaBrevo')), /UrlFetchApp\.fetch/);
});

test('burst check-ins shorten lock time, retry BUSY safely, and use distinct result sounds', () => {
  const handler = backend.slice(backend.indexOf('function handleCheckIn_'), backend.indexOf('function getSharedDuplicateAttendance_'));
  assert.match(handler, /findQrRowCached_[\s\S]*const lock = LockService\.getScriptLock\(\)/);
  assert.match(handler, /findTeacherByQrCached_[\s\S]*const lock = LockService\.getScriptLock\(\)/);
  assert.match(page, /postCheckInWithBusyRetry/);
  assert.match(page, /data\.code !== 'BUSY'/);
  assert.match(page, /retry: attempt > 0/);
  assert.match(page, /順番に受付しています/);
  assert.match(page, /function playSuccessSound\(\)/);
  assert.match(page, /function playErrorSound\(\)/);
  assert.match(page, /if \(ok\) playSuccessSound\(\);[\s\S]*else playErrorSound\(\);/);
});

test('normal requests use receipt and daily-state caches before persistent scans', () => {
  assert.match(backend, /getCachedReceiptStatus_\(receipt\) \|\| \(isRetry \? getReceiptStatus_\(receipt, true\) : null\)/);
  assert.match(backend, /if \(prior && prior\.attendanceSaved\)/);
  assert.match(backend, /if \(repeated && repeated\.attendanceSaved\)/);
  assert.match(backend, /dailyCheckInStateKey_\('student'/);
  assert.match(backend, /dailyCheckInStateKey_\('teacher'/);
  assert.match(backend, /getRange\(2, 1, logSheet\.getLastRow\(\) - 1, 4\)/);
});

test('daily attendance point uses the first and latest stamp regardless of intermediate scans', () => {
  assert.match(backend, /CHECKIN_DAY_V2:/);
  assert.match(backend, /function isDailyStayQualified_\(firstStampMs, currentStampMs, minMinutes\)/);
  assert.match(backend, /firstStampMs: stampTimes\.length \? stampTimes\[0\] : 0/);
  assert.match(backend, /state\.count > 0[\s\S]*isDailyStayQualified_\(state\.firstStampMs, now\.getTime\(\), settings\.minMinutes\)/);
  assert.match(backend, /if \(!state\.firstStampMs\) state\.firstStampMs = now\.getTime\(\)/);
  assert.doesNotMatch(
    backend.slice(backend.indexOf('function saveStudentAttendance_'), backend.indexOf('function saveTeacherAttendance_')),
    /now\.getTime\(\) - state\.lastEntryMs/
  );

  const source = backend.match(/function isDailyStayQualified_\([\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const context = {};
  vm.runInNewContext(source, context);
  const first = Date.UTC(2026, 7, 4, 1, 0, 0);
  assert.equal(context.isDailyStayQualified_(first, first + 9 * 60000 + 59000, 10), false);
  assert.equal(context.isDailyStayQualified_(first, first + 10 * 60000, 10), true);
  assert.equal(context.isDailyStayQualified_(first, first + 30 * 60000, 10), true);
});

test('public errors are distinct', () => {
  for (const code of ['INVALID_QR_FORMAT', 'TARGET_NOT_FOUND', 'SAVE_FAILED', 'TIMEOUT', 'ALREADY_PROCESSED']) {
    assert.match(page + backend, new RegExp(code));
  }
});
