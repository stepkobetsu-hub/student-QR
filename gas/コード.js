
/**
 * ===================================================================
 * 入退室管理システム 統合バックエンド (GAS)
 * ・生徒QRの登録／照会（管理画面用）
 * ・新規生徒QRの発行
 * ・QRスキャンによる入退室判定・記録
 * ・Brevo経由での保護者へのメール通知（写真添付）
 * ・来塾ポイントの自動付与
 * ===================================================================
 *
 * 【このファイルの使い方】
 * GASプロジェクトの中身をこのファイルの内容で丸ごと置き換えてください。
 *
 * 【事前準備（初回のみ）】
 * 1. スクリプトプロパティに以下を設定
 *    - BREVO_API_KEY: BrevoのAPIキー
 *    - （任意）POINTS_PER_VISIT: 1回の来塾で付与するポイント数（未設定なら1）
 *    - （任意）MIN_STAY_MINUTES: ポイント付与に必要な最低滞在分数（未設定なら10）
 * 2. setupQrColumn() を実行 → ★生徒マスタのAZ1に見出しを追加（済んでいればスキップ可）
 * 3. setupCheckInLogSheet() を実行 → 入退室ログ・ポイント履歴のシートを作成
 * 4. 「デプロイ」→「新しいデプロイ」（または既存デプロイの「新しいバージョン」）
 * ===================================================================
 */

const MASTER_SS_ID = '1CIJkTlYUcUkbb8jBdFc6L8D5ubTGsxwNxFv01ten-Zk';
const MASTER_SHEET_NAME = '☆マスタ';

// 講師マスター（勤怠管理用）
const TEACHER_SS_ID = '1L5aFDXAmfUDkBg8d7X3WqJgMhdMq5tM5sfUZ2G-M58E';
const TEACHER_SHEET_NAME = '講師マスター';
const TEACHER_COL_CODE = 1;  // A列: コード（7000番台）
const TEACHER_COL_NAME = 2;  // B列: 氏名
const TEACHER_COL_EMAIL = 16; // P列: メールアドレス（行配列では index 15）
const TEACHER_COL_QR = 17;   // Q列: QRナンバー
const TEACHER_INDEX_CACHE_VERSION = 'v43-email-p15';

const COL_STUDENT_ID = 1;      // A列: 生徒番号
const COL_STUDENT_NAME = 5;    // E列: 生徒氏名
const COL_SCHOOL = 8;          // H列: 校舎
const COL_GUARDIAN_EMAIL = 24; // X列: メールアドレス（保護者）
const COL_QR_DATA = 52;        // AZ列: QRデータ
const COL_NOTIFY_EMAILS = [63, 64, 65, 66]; // BK〜BN列: 入退室通知メール1〜4
const DELIVERY_EMAIL_COLS = [24, 53, 54, 55]; // X, BA, BB, BC
const DELIVERY_EMAIL_ENABLED_COLS = [67, 68, 69, 70]; // BO, BP, BQ, BR

const DEFAULT_FROM_NAME  = 'Step個別指導ステップ';
const SCHOOL_DISPLAY_NAME = '個別指導ステップ';
const CHECKIN_RECEIPT_HEADER = '受付ID';
const CHECKIN_TIMING_HEADER = '処理時間JSON';
const CHECKIN_MAIL_QUEUE_SHEET = 'メール送信キュー';
const CHECKIN_MAIL_QUEUE_HEADERS = ['受付ID','登録日時','更新日時','状態','試行回数','次回試行日時','生徒番号','生徒氏名','種別','受付日時','送信先JSON','写真ファイルID','最終エラー','BrevoメッセージIDJSON','照合IDJSON','送信完了日時','ログ行'];
const CHECKIN_MAIL_MAX_ATTEMPTS = 3;
const CHECKIN_PHOTO_CACHE_PREFIX = 'CHECKIN_PHOTO_V1:';
const CHECKIN_PHOTO_CACHE_MAX_CHARS = 95000;
const CHECKIN_DUPLICATE_WINDOW_MS = 60 * 1000;
const CHECKIN_DUPLICATE_GUARD_PREFIX = 'CHECKIN_DUPLICATE_GUARD_V1:';
const CHECKIN_BUILD_ID = 'duplicate-log-canonical-v64';

/**
 * ===================================================================
 * エントリーポイント
 * ===================================================================
 */

// 管理画面（生徒QR登録）からのJSONPリクエスト用
function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action;
  const callback = params.callback;
  let result;

  try {
    if (action === 'myQrHealth') {
      result = { ok: true, service: 'STEP_MY_QR', status: 'ready', build: CHECKIN_BUILD_ID, duplicateWindowSeconds: CHECKIN_DUPLICATE_WINDOW_MS / 1000 };
    } else {
      // 旧管理APIはスタッフの期限付きセッションを必須にする。
      // 塾生用APIはPOST専用で、この経路から任意の生徒QRを取得できない。
      requireQrStaffSession_(params);
      if (action === 'getStudent') {
        result = getStudent_(params.code);
      } else if (action === 'saveQrData') {
        result = saveStudentQrData_(params.code, params.qrData);
      } else if (action === 'issueNewQr') {
        result = issueNewStudentQr_(params.code);
      } else if (action === 'getNotifyEmails') {
        result = getNotifyEmails_(params.code);
      } else if (action === 'saveNotifyEmails') {
        const emails = JSON.parse(params.emails || '[]');
        result = saveNotifyEmails_(params.code, emails);
      } else if (action === 'getPointsInfo') {
        result = getPointsInfo_(params.code);
      } else if (action === 'addPoints') {
        result = addManualPoints_(params.code, params.points, params.reason);
      } else if (action === 'getPointsHistory') {
        result = getPointsHistory_(params.code);
      } else {
        result = { ok: false, message: '不明なアクションです: ' + action };
      }
    }
  } catch (err) {
    result = { ok: false, message: err.message };
  }

  const json = JSON.stringify(result);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// タブレットの入退室画面（写真データを含む）からのPOSTリクエスト用
function doPost(e) {
  const requestStartedAt = Date.now();
  let result;
  try {
    const rawBody = e && e.postData ? String(e.postData.contents || '') : '';
    const body = JSON.parse(rawBody || '{}');
    const action = String(body.action || '');
    const isPointManagerRequest = /^pointManager/.test(action);
    const pointManagerAvailable = typeof isPointManagerApiAction_ === 'function' &&
      typeof handlePointManagerApiAction_ === 'function';
    if (isPointManagerRequest && !pointManagerAvailable) {
      result = {
        ok: false,
        code: 'POINT_MANAGER_MODULE_MISSING',
        message: 'ポイント管理機能を読み込めませんでした。管理者へ連絡してください。'
      };
    } else if (pointManagerAvailable && isPointManagerApiAction_(action)) {
      result = handlePointManagerApiAction_(body);
    } else if (typeof isMyQrApiAction_ === 'function' && isMyQrApiAction_(action)) {
      result = handleMyQrApiAction_(body);
    } else if (typeof isBrevoWebhookRequest_ === 'function' && isBrevoWebhookRequest_(e, body)) {
      result = handleBrevoWebhook_(body, rawBody);
    } else if (action === 'checkIn') {
      result = handleCheckIn_(body.qrData, body.photoBase64, body.receiptId, body.clientTimings, body.retry === true);
    } else if (action === 'getReceiptStatus') {
      result = getReceiptStatus_(body.receiptId);
    } else if (action === 'sendQrPdf') {
      result = sendQrPdfEmail_(body.code, body.toEmail, body.pdfBase64);
    } else if (typeof isDeliveryFailureAdminAction_ === 'function' && isDeliveryFailureAdminAction_(action)) {
      result = handleDeliveryFailureAdminAction_(body);
    } else {
      result = { ok: false, message: '不明なアクションです: ' + action };
    }
  } catch (err) {
    console.error('check-in request failed', sanitizeCheckInError_(err));
    result = { ok: false, code: 'INTERNAL_ERROR', attendanceSaved: false, mailStatus: 'NOT_STARTED', message: '処理中にエラーが発生しました' };
  }
  result = result || { ok: false, code: 'INTERNAL_ERROR', attendanceSaved: false, mailStatus: 'NOT_STARTED', message: '処理結果を取得できませんでした' };
  result.serverResponseMs = Date.now() - requestStartedAt;
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * ===================================================================
 * 生徒マスタ 操作
 * ===================================================================
 */

function getMasterSheet_() {
  return SpreadsheetApp.openById(MASTER_SS_ID).getSheetByName(MASTER_SHEET_NAME);
}

function findStudentRow_(sheet, code) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, COL_STUDENT_ID, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(code).trim()) {
      return i + 2;
    }
  }
  return -1;
}

function findStudentRowByQrData_(sheet, qrData) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, COL_QR_DATA, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(qrData).trim() !== '' && String(values[i][0]).trim() === String(qrData).trim()) {
      return i + 2;
    }
  }
  return -1;
}

function getStudent_(code) {
  if (!code) return { ok: false, message: '生徒番号を入力してください' };
  const sheet = getMasterSheet_();
  const row = findStudentRow_(sheet, code);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません（生徒番号を確認してください）' };

  return {
    ok: true,
    name: sheet.getRange(row, COL_STUDENT_NAME).getValue(),
    school: sheet.getRange(row, COL_SCHOOL).getValue(),
    qrData: sheet.getRange(row, COL_QR_DATA).getValue()
  };
}

function saveStudentQrData_(code, qrData) {
  if (!code || !qrData) return { ok: false, message: '生徒番号とQRデータの両方を入力してください' };
  const sheet = getMasterSheet_();
  const row = findStudentRow_(sheet, code);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません（生徒番号を確認してください）' };

  sheet.getRange(row, COL_QR_DATA).setValue(qrData);
  return { ok: true, name: sheet.getRange(row, COL_STUDENT_NAME).getValue() };
}

/**
 * 新規生徒のQRを発行する（中身は "STEP-生徒番号"）
 * 発行と同時にAZ列に自動保存し、QR画像のURLを返す
 */
function issueNewStudentQr_(code) {
  if (!code) return { ok: false, message: '生徒番号を入力してください' };
  const sheet = getMasterSheet_();
  const row = findStudentRow_(sheet, code);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません（生徒番号を確認してください）' };

  const qrData = 'STEP-' + String(code).trim();
  sheet.getRange(row, COL_QR_DATA).setValue(qrData);

  const name = sheet.getRange(row, COL_STUDENT_NAME).getValue();
  const qrImageUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrData);

  return { ok: true, name: name, qrData: qrData, qrImageUrl: qrImageUrl };
}

/**
 * その生徒の通知先メール一覧（最大4件）を取得
 * BK〜BN列が空の場合は、X列（保護者メール）を1件だけ返す
 */
function getNotifyEmailsForRow_(sheet, row) {
  const seen = {};
  const configured = {};
  const result = [];
  DELIVERY_EMAIL_COLS.forEach((col, i) => {
    const email = String(sheet.getRange(row, col).getValue()).trim();
    const flag = String(sheet.getRange(row, DELIVERY_EMAIL_ENABLED_COLS[i]).getValue()).trim().toUpperCase();
    const key = normalizeDeliveryEmail_(email);
    if (email) configured[key] = true;
    if (!email || flag === '0' || flag === 'FALSE') return;
    if (!seen[key]) { seen[key] = true; result.push(email); }
  });
  // 旧BK〜BN列も互換用に残す。新構成に未登録のアドレスだけ補完する。
  COL_NOTIFY_EMAILS.forEach(col => {
    const email = String(sheet.getRange(row, col).getValue()).trim();
    const key = normalizeDeliveryEmail_(email);
    if (email && !seen[key] && !configured[key]) { seen[key] = true; result.push(email); }
  });
  return result;
}

function getNotifyEmailsFromValues_(rowValues) {
  const seen = {};
  const configured = {};
  const result = [];
  DELIVERY_EMAIL_COLS.forEach((col, i) => {
    const email = String(rowValues[col - 1] || '').trim();
    const flag = String(rowValues[DELIVERY_EMAIL_ENABLED_COLS[i] - 1] || '').trim().toUpperCase();
    const key = normalizeDeliveryEmail_(email);
    if (email) configured[key] = true;
    if (!email || flag === '0' || flag === 'FALSE') return;
    if (!seen[key]) { seen[key] = true; result.push(email); }
  });
  COL_NOTIFY_EMAILS.forEach(col => {
    const email = String(rowValues[col - 1] || '').trim();
    const key = normalizeDeliveryEmail_(email);
    if (email && !seen[key] && !configured[key]) { seen[key] = true; result.push(email); }
  });
  return result;
}

function getNotifyEmails_(code) {
  if (!code) return { ok: false, message: '生徒番号を入力してください' };
  const sheet = getMasterSheet_();
  const row = findStudentRow_(sheet, code);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません' };

  const registered = COL_NOTIFY_EMAILS.map(col => String(sheet.getRange(row, col).getValue()).trim());
  const guardianEmail = String(sheet.getRange(row, COL_GUARDIAN_EMAIL).getValue()).trim();

  return {
    ok: true,
    name: sheet.getRange(row, COL_STUDENT_NAME).getValue(),
    emails: registered,
    guardianEmail: guardianEmail
  };
}

function saveNotifyEmails_(code, emails) {
  if (!code) return { ok: false, message: '生徒番号を入力してください' };
  const sheet = getMasterSheet_();
  const row = findStudentRow_(sheet, code);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません' };

  COL_NOTIFY_EMAILS.forEach((col, i) => {
    const value = (emails[i] || '').trim();
    sheet.getRange(row, col).setValue(value);
  });

  return { ok: true, name: sheet.getRange(row, COL_STUDENT_NAME).getValue() };
}

/**
 * ===================================================================
 * 入退室ログ／ポイント履歴 スプレッドシート 操作
 * ===================================================================
 */

function getCheckInFromEmail_() {
  const value = String(PropertiesService.getScriptProperties().getProperty('CHECKIN_FROM_EMAIL') || '').trim();
  if (!value) throw new Error('CHECKIN_FROM_EMAIL がスクリプトプロパティに設定されていません');
  return value;
}

function getCheckInShareEmails_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty('CHECKIN_SHARE_WITH_EMAILS') || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).map(value => value.trim()).filter(Boolean);
  } catch (ignore) {}
  return raw.split(',').map(value => value.trim()).filter(Boolean);
}

function getCheckInSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('CHECKIN_LOG_SS_ID');

  if (!ssId) {
    const ss = SpreadsheetApp.create('入退室ログ');
    ssId = ss.getId();
    props.setProperty('CHECKIN_LOG_SS_ID', ssId);
    shareCheckInSpreadsheet_(ss);
    Logger.log('入退室ログのスプレッドシートを新規作成しました。ID: ' + ssId);
    Logger.log('URL: ' + ss.getUrl());
  }

  return SpreadsheetApp.openById(ssId);
}

function shareCheckInSpreadsheet_(ss) {
  getCheckInShareEmails_().forEach(email => {
    try {
      ss.addEditor(email);
    } catch (err) {
      Logger.log('共有に失敗（' + email + '）: ' + err.message);
    }
  });
}

/**
 * 既に作成済みのスプレッドシートを、後から関係者に共有し直したいときに実行
 */
function shareCheckInSpreadsheetNow() {
  const ss = getCheckInSpreadsheet_();
  shareCheckInSpreadsheet_(ss);
  Logger.log('共有設定を行いました。URL: ' + ss.getUrl());
}

function getLogSheet_() {
  const ss = getCheckInSpreadsheet_();
  let sheet = ss.getSheetByName('ログ');
  if (!sheet) {
    sheet = ss.insertSheet('ログ');
    sheet.appendRow(['タイムスタンプ', '生徒番号', '生徒氏名', '種別', '校舎', 'メール送信結果', '送信先メール']);
    sheet.setFrozenRows(1);
  }
  ensureDeliveryLogColumns_(sheet);
  return sheet;
}

function getPointsSheet_() {
  const ss = getCheckInSpreadsheet_();
  let sheet = ss.getSheetByName('ポイント履歴');
  if (!sheet) {
    sheet = ss.insertSheet('ポイント履歴');
    sheet.appendRow(['日付', '生徒番号', '生徒氏名', 'ポイント', '理由']);
    sheet.setFrozenRows(1);
    // 最初のシート（ログ）が2番目に来ないよう順序を整える
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(2);
  }
  return sheet;
}

/**
 * ポイント設定（スクリプトプロパティで変更可能）
 */
function getPointSettings_() {
  const props = PropertiesService.getScriptProperties();
  const perVisit = Math.max(1, Math.floor(Number(props.getProperty('POINTS_PER_VISIT')) || 1));
  const minMinutes = Math.max(0, Number(props.getProperty('MIN_STAY_MINUTES')) || 10);
  return {
    enabled: String(props.getProperty('POINTS_ENABLED') || 'true') !== 'false',
    timing: String(props.getProperty('POINT_AWARD_TIMING') || 'exit') === 'entry' ? 'entry' : 'exit',
    dailyLimit: String(props.getProperty('POINT_DAILY_LIMIT') || 'once') === 'none' ? 'none' : 'once',
    perVisit: perVisit,
    minMinutes: minMinutes
  };
}

/**
 * 当日の最初の打刻から現在の打刻までに、必要滞在時間が経過したかを判定する。
 * 途中の入室／退室の回数や種別には依存しない。
 */
function isDailyStayQualified_(firstStampMs, currentStampMs, minMinutes) {
  const first = Number(firstStampMs) || 0;
  const current = Number(currentStampMs) || 0;
  const requiredMs = Math.max(0, Number(minMinutes) || 0) * 60000;
  return first > 0 && current >= first && (current - first) >= requiredMs;
}

/**
 * その生徒の「今日」の記録回数から、入室／退室を自動判定する
 * 偶数回目（0, 2, 4...）→ 入室 / 奇数回目（1, 3, 5...）→ 退室
 */
function determineCheckType_(logSheet, studentCode, todayStr) {
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return '入室';

  const data = logSheet.getRange(2, 1, lastRow - 1, 2).getValues(); // タイムスタンプ, 生徒番号
  let countToday = 0;
  data.forEach(row => {
    const ts = row[0];
    const code = row[1];
    if (!(ts instanceof Date)) return;
    const tsDate = Utilities.formatDate(ts, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (tsDate === todayStr && String(code).trim() === String(studentCode).trim()) {
      countToday++;
    }
  });

  return (countToday % 2 === 0) ? '入室' : '退室';
}

/**
 * その生徒の当日の最後の「入室」記録（時刻）を取得する（滞在時間の計算用）
 */
function findLastCheckInToday_(logSheet, studentCode, todayStr) {
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return null;
  const data = logSheet.getRange(2, 1, lastRow - 1, 4).getValues(); // タイムスタンプ, 生徒番号, 生徒氏名, 種別

  let lastCheckIn = null;
  data.forEach(row => {
    const ts = row[0];
    const code = row[1];
    const type = row[3];
    if (!(ts instanceof Date)) return;
    const tsDate = Utilities.formatDate(ts, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (tsDate === todayStr && String(code).trim() === String(studentCode).trim() && type === '入室') {
      lastCheckIn = ts;
    }
  });
  return lastCheckIn;
}

/**
 * 過去（今日より前）に「入室」のまま記録が途切れている日がないか探す。
 * 見つかった場合、その日付・生徒番号を返す（複数ある場合は直近の1件のみ）。
 */
function findUnclosedPreviousSession_(logSheet, studentCode, todayStr) {
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return null;
  const data = logSheet.g…13506 tokens truncated…tRange(masterRow, 1, 1, width).getValues()[0];
  const recipients = getNotifyEmailsFromValues_(values);
  const recipient = String(recipients[0] || '').trim();

  const logSheet = getLogSheet_();
  const logSchema = ensureCheckInLogSchema_(logSheet);
  const codeCol = logSchema.headers.indexOf('生徒番号');
  const receiptCol = logSchema.headers.indexOf(CHECKIN_RECEIPT_HEADER);
  let logRow = -1;
  let logValues = null;
  if (codeCol >= 0 && logSheet.getLastRow() >= 2) {
    const rows = logSheet.getRange(2, 1, logSheet.getLastRow() - 1, logSchema.lastColumn).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][codeCol]).trim() === requestedCode) { logRow = i + 2; logValues = rows[i]; break; }
    }
  }
  const value = header => logValues && logValues[logSchema.headers.indexOf(header)];
  const receiptId = receiptCol >= 0 ? String(value(CHECKIN_RECEIPT_HEADER) || '').trim() : '';
  const queueSheet = getCheckInMailQueueSheet_();
  const queueMatch = receiptId && queueSheet.getLastRow() >= 2
    ? queueSheet.getRange(2, 1, queueSheet.getLastRow() - 1, 1).createTextFinder(receiptId).matchEntireCell(true).findNext()
    : null;
  const queue = queueMatch ? queueSheet.getRange(queueMatch.getRow(), 1, 1, CHECKIN_MAIL_QUEUE_HEADERS.length).getValues()[0] : null;
  const triggers = ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'processCheckInMailQueue');
  const config = getCheckInMailConfigStatus_();
  const storedError = String(value('最終エラー理由') || '');
  const errorCode = !config.ok ? config.code : (queue && queue[3] === 'PENDING' && !triggers.length ? 'MAIL_WORKER_NOT_RUNNING' : checkInMailErrorCode_(storedError));
  const result = {
    studentFound: true,
    studentCodeMasked: maskCheckInId_(requestedCode),
    recipientPresent: !!recipient,
    recipientLength: recipient.length,
    recipientDomainMasked: maskEmailDomain_(recipient),
    provider: config.provider || 'BREVO',
    apiKeyPresent: config.brevoApiKeyPresent,
    senderPresent: config.fromEmailPresent,
    queueCreated: !!queue,
    queueProcessed: !!(queue && Number(queue[4] || 0) > 0),
    queueStatus: queue ? String(queue[3] || '') : 'NOT_CREATED',
    workerTriggerPresent: triggers.length === 1,
    providerStatus: queue ? String(queue[3] || '') : String(value('配信状態') || value('メール送信結果') || ''),
    errorCode: errorCode,
    receiptPresent: !!receiptId,
    attendanceLogFound: logRow >= 2,
    deliveryFailureRecorded: false
  };
  console.log(JSON.stringify(result));
  return result;
}

function diagnoseCheckInMailQueueHealth() {
  const sheet = getCheckInMailQueueSheet_();
  const result = { total: 0, pending: 0, retry: 0, processing: 0, sent: 0, failed: 0, stopped: 0 };
  if (sheet.getLastRow() >= 2) {
    const states = sheet.getRange(2, 4, sheet.getLastRow() - 1, 1).getDisplayValues();
    states.forEach(row => {
      const key = String(row[0] || '').trim().toLowerCase();
      result.total++;
      if (Object.prototype.hasOwnProperty.call(result, key)) result[key]++;
    });
  }
  result.workerTriggerPresent = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'processCheckInMailQueue');
  result.diagnosticMode = String(PropertiesService.getScriptProperties().getProperty('CHECKIN_MAIL_DIAGNOSTIC_MODE') || '').trim().toUpperCase() === 'TRUE';
  console.log(JSON.stringify(result));
  Logger.log(JSON.stringify(result));
  return result;
}

function runCheckInMailDummyDiagnostics() {
  const props = PropertiesService.getScriptProperties();
  const previousMode = props.getProperty('CHECKIN_MAIL_DIAGNOSTIC_MODE');
  const health = diagnoseCheckInMailQueueHealth();
  if (health.pending || health.retry || health.processing) throw new Error('MAIL_QUEUE_NOT_IDLE');
  props.setProperty('CHECKIN_MAIL_DIAGNOSTIC_MODE', 'TRUE');
  const queue = getCheckInMailQueueSheet_();
  const before = queue.getLastRow();
  const runId = Utilities.getUuid();
  const onePixelJpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==';
  const cases = [
    { role: 'student', photo: false, type: '入室' },
    { role: 'student', photo: true, type: '退室' },
    { role: 'teacher', photo: false, type: '出勤' },
    { role: 'teacher', photo: true, type: '退勤' }
  ];
  const receipts = [];
  try {
    cases.forEach((item, index) => {
      const receiptId = 'diag-' + runId + '-' + index;
      const photoId = item.photo ? saveCheckInPhoto_(onePixelJpeg, receiptId) : '';
      const attendance = { receiptId: receiptId, name: 'ダミー', type: item.type, logRow: 0 };
      enqueueCheckInMail_(attendance, ['dummy@invalid.example'], photoId);
      enqueueCheckInMail_(attendance, ['dummy@invalid.example'], photoId);
      receipts.push(receiptId);
    });
    receipts.forEach(receiptId => {
      const match = queue.getRange(2, 1, queue.getLastRow() - 1, 1).createTextFinder(receiptId).matchEntireCell(true).findNext();
      if (match) processCheckInMailQueueRow_(queue, match.getRow(), queue.getRange(match.getRow(), 1, 1, CHECKIN_MAIL_QUEUE_HEADERS.length).getValues()[0]);
    });
    const rows = queue.getRange(before + 1, 1, queue.getLastRow() - before, CHECKIN_MAIL_QUEUE_HEADERS.length).getValues();
    const result = {
      cases: cases.length,
      queueRowsCreated: rows.length,
      sent: rows.filter(row => String(row[3]) === 'SENT').length,
      failed: rows.filter(row => String(row[3]) === 'FAILED').length,
      duplicateQueueRows: rows.length - new Set(rows.map(row => String(row[0]))).size,
      photoCases: rows.filter(row => !!row[11]).length,
      provider: 'DIAGNOSTIC'
    };
    console.log(JSON.stringify(result));
    Logger.log(JSON.stringify(result));
    return result;
  } finally {
    if (previousMode == null) props.deleteProperty('CHECKIN_MAIL_DIAGNOSTIC_MODE');
    else props.setProperty('CHECKIN_MAIL_DIAGNOSTIC_MODE', previousMode);
  }
}

function sendApprovedMailAppFallbackTestToConfiguredSender() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('CHECKIN_MAILAPP_APPROVED_TEST_ATTEMPTED_AT')) throw new Error('APPROVED_TEST_ALREADY_ATTEMPTED');
  if (String(props.getProperty('BREVO_API_KEY') || '').trim()) throw new Error('BREVO_IS_CONFIGURED');
  const recipient = String(props.getProperty('CHECKIN_FROM_EMAIL') || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('APPROVED_TEST_RECIPIENT_INVALID');
  const attemptId = Utilities.getUuid();
  props.setProperty('CHECKIN_MAILAPP_APPROVED_TEST_ATTEMPTED_AT', new Date().toISOString());
  const onePixelJpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==';
  const result = sendEmailViaMailAppFallback_(
    recipient,
    '【動作確認】入退室通知メール',
    '入退室通知のMailApp一時送信テストです。<br>実在する生徒・講師の受付ではありません。',
    { correlationId: 'approved-test-' + attemptId, attachmentBase64: onePixelJpeg, attachmentName: 'mailapp-test.jpg' }
  );
  const safeResult = {
    accepted: !!(result && result.accepted),
    provider: result && result.provider || '',
    recipientPresent: !!recipient,
    recipientLength: recipient.length,
    recipientDomainMasked: maskEmailDomain_(recipient),
    attachmentPresent: true,
    errorCode: result && result.errorCode || ''
  };
  console.log(JSON.stringify(safeResult));
  Logger.log(JSON.stringify(safeResult));
  return safeResult;
}

function maskEmailDomain_(email) {
  const domain = String(email || '').trim().split('@')[1] || '';
  if (!domain) return '';
  const dot = domain.lastIndexOf('.');
  const suffix = dot >= 0 ? domain.slice(dot) : '';
  const base = dot >= 0 ? domain.slice(0, dot) : domain;
  return (base ? base.charAt(0) + '***' : '***') + suffix;
}

function checkInMailErrorCode_(value) {
  const text = String(value || '');
  const known = ['MAILAPP_FALLBACK_ACTIVE','MAILAPP_SEND_FAILED','MAILAPP_DELIVERY_UNCERTAIN','BREVO_API_KEY_MISSING','MAIL_QUEUE_CREATE_FAILED','MAIL_WORKER_NOT_RUNNING','BREVO_AUTH_FAILED','BREVO_SEND_REJECTED','SENDER_CONFIG_INVALID','RECIPIENT_INVALID','PHOTO_PROCESS_FAILED','BREVO_API_TIMEOUT','TEACHER_EMAIL_INVALID','BREVO_SEND_FAILED'];
  for (let i = 0; i < known.length; i++) if (text.indexOf(known[i]) >= 0) return known[i];
  return text ? 'BREVO_SEND_FAILED' : '';
}

function isValidCheckInQrFormat_(value) { return /^(?:STEP-[A-Za-z0-9_-]{1,40}|[0-9]{12,64})$/.test(String(value || '').trim()); }
function isValidReceiptId_(value) { return /^(?:[0-9a-f]{8}-[0-9a-f-]{27,36}|qr-[a-z0-9-]{10,80})$/i.test(String(value || '').trim()); }
function shortCheckInHash_(value) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)).replace(/=+$/,'').slice(0,22); }
function maskCheckInId_(value) { const text = String(value || ''); return text.length <= 2 ? '**' : '*'.repeat(Math.min(6, text.length - 2)) + text.slice(-2); }
function sanitizeCheckInError_(error) { return String(error && error.message || error || 'error').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig,'[email]').replace(/\b\d{5,}\b/g,'[id]').slice(0,180); }

function createCheckInTrace_(receiptId) { return { receiptId: String(receiptId || ''), startedAt: Date.now(), lastAt: Date.now(), steps: {} }; }
function traceMark_(trace, name) { const now = Date.now(); trace.steps[name] = now - trace.lastAt; trace.lastAt = now; }
function finishCheckInTrace_(trace) { trace.steps.total = Date.now() - trace.startedAt; return trace.steps; }
function checkInFailure_(code, message, trace) { const result = { ok: false, code: code, attendanceSaved: false, mailStatus: 'NOT_STARTED', message: message, timings: finishCheckInTrace_(trace) }; logCheckInTrace_(trace, result, 'failed'); return result; }
function logCheckInTrace_(trace, result, phase) { console.log(JSON.stringify({ event: 'checkin_trace', phase: phase, receiptId: trace.receiptId, subject: result.maskedSubjectId || '', attendanceSaved: !!result.attendanceSaved, mailStatus: result.mailStatus || 'NOT_STARTED', code: result.code || '', steps: trace.steps })); }

/**
 * ===================================================================
 * Brevo優先・MailApp一時フォールバックでのメール送信
 * ===================================================================
 */
function sendEmailViaBrevo(toEmail, subject, htmlBody, options) {
  options = options || {};

  const props = PropertiesService.getScriptProperties();
  const diagnosticMode = String(props.getProperty('CHECKIN_MAIL_DIAGNOSTIC_MODE') || '').trim().toUpperCase() === 'TRUE';
  if (diagnosticMode) {
    return { accepted: true, provider: 'DIAGNOSTIC', messageId: 'diagnostic-' + Utilities.getUuid(), acceptedAt: new Date(), error: '', httpStatus: 204, correlationId: options.correlationId || Utilities.getUuid() };
  }

  const apiKey = props.getProperty('BREVO_API_KEY');
  if (!apiKey) {
    return sendEmailViaMailAppFallback_(toEmail, subject, htmlBody, options);
  }

  const correlationId = options.correlationId || Utilities.getUuid();
  const payload = {
    sender: {
      name: options.fromName || DEFAULT_FROM_NAME,
      email: options.fromEmail || getCheckInFromEmail_()
    },
    to: [{
      email: toEmail,
      name: options.toName || toEmail
    }],
    subject: subject,
    htmlContent: htmlBody,
    tags: options.tags || ['student-qr'],
    headers: { 'X-Mailin-custom': 'correlation_id:' + correlationId }
  };

  if (options.attachmentBase64 && options.attachmentName) {
    payload.attachment = [{
      content: options.attachmentBase64,
      name: options.attachmentName
    }];
  }

  const res = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'api-key': apiKey,
      'accept': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  let response = {};
  try { response = JSON.parse(res.getContentText() || '{}'); } catch (ignore) {}
  if (code >= 200 && code < 300) {
    return { accepted: true, provider: 'BREVO', messageId: String(response.messageId || ''), acceptedAt: new Date(), error: '', httpStatus: code, correlationId: correlationId };
  }
  const errorCode = code === 401 || code === 403 ? 'BREVO_AUTH_FAILED' : 'BREVO_SEND_REJECTED';
  return { accepted: false, provider: 'BREVO', messageId: '', acceptedAt: new Date(), error: 'Brevo送信失敗 (' + code + '): ' + res.getContentText(), errorCode: errorCode, httpStatus: code, correlationId: correlationId };
}

function sendEmailViaMailAppFallback_(toEmail, subject, htmlBody, options) {
  options = options || {};
  const correlationId = options.correlationId || Utilities.getUuid();
  const message = {
    to: toEmail,
    subject: subject,
    body: String(htmlBody || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ''),
    htmlBody: htmlBody,
    name: options.fromName || DEFAULT_FROM_NAME
  };
  if (options.attachmentBase64 && options.attachmentName) {
    const mimeType = /\.pdf$/i.test(options.attachmentName) ? 'application/pdf' : 'image/jpeg';
    message.attachments = [Utilities.newBlob(Utilities.base64Decode(options.attachmentBase64), mimeType, options.attachmentName)];
  }
  try {
    MailApp.sendEmail(message);
    console.warn(JSON.stringify({ event: 'mail_provider_fallback', provider: 'MAILAPP_FALLBACK', correlationId: correlationId, attachmentPresent: !!message.attachments }));
    return { accepted: true, provider: 'MAILAPP_FALLBACK', messageId: '', acceptedAt: new Date(), error: '', httpStatus: 202, correlationId: correlationId };
  } catch (error) {
    return { accepted: false, provider: 'MAILAPP_FALLBACK', messageId: '', acceptedAt: new Date(), error: sanitizeCheckInError_(error), errorCode: 'MAILAPP_SEND_FAILED', httpStatus: 0, correlationId: correlationId };
  }
}

/**
 * 入退室メールの文面（指定フォーマット通り）
 */
function sendCheckInEmail_(studentName, guardianEmail, photoBase64, type, now, receiptId) {
  const label = Utilities.formatDate(now, 'Asia/Tokyo', 'M月d日H時mm分');

  const isTeacher = type === '出勤' || type === '退勤';
  const subject = type + 'のお知らせ';
  const bodyText = studentName + (isTeacher ? '先生が' : 'さんが') + SCHOOL_DISPLAY_NAME + 'に' + type + 'しました。\n' + label + '\n' + SCHOOL_DISPLAY_NAME;
  const htmlBody = bodyText.replace(/\n/g, '<br>');

  const options = {
    toName: isTeacher ? studentName + '先生' : studentName + '様 保護者',
    tags: ['student-qr', type === '入室' ? 'checkin' : 'checkout'],
    correlationId: receiptId ? String(receiptId) + '-' + shortCheckInHash_(guardianEmail).slice(0, 10) : undefined
  };

  if (photoBase64) {
    const cleanBase64 = photoBase64.replace(/^data:image\/\w+;base64,/, '');
    options.attachmentBase64 = cleanBase64;
    options.attachmentName = studentName + '_' + type + '_' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd_HHmm') + '.jpg';
  }

  return sendEmailViaBrevo(guardianEmail, subject, htmlBody, options);
}

/**
 * 【入退くんからのポイント引き継ぎ用】
 * 「一括インポート」シートに生徒番号とポイントを入力してから実行すると、
 * まとめてポイント履歴に取り込まれます。
 *
 * 使い方:
 * 1. 一度この関数を実行 → 「一括インポート」シートが自動作成されます
 * 2. そのシートのA列に生徒番号、B列にポイント数を入力（何行でもOK）
 * 3. もう一度この関数を実行 → まとめて取り込まれます
 */
function importPointsFromBulkSheet() {
  const ss = getCheckInSpreadsheet_();
  let sheet = ss.getSheetByName('一括インポート');
  if (!sheet) {
    sheet = ss.insertSheet('一括インポート');
    sheet.appendRow(['生徒番号', 'ポイント']);
    sheet.setFrozenRows(1);
    Logger.log('「一括インポート」シートを作成しました。生徒番号とポイントを入力してから、もう一度この関数を実行してください。');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データが入力されていません。「一括インポート」シートに生徒番号とポイントを入力してください。');
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const masterSheet = getMasterSheet_();
  const pointsSheet = getPointsSheet_();
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  let count = 0;
  let notFound = [];
  data.forEach(row => {
    const code = String(row[0]).trim();
    const points = Number(row[1]);
    if (!code || !points) return;

    const studentRow = findStudentRow_(masterSheet, code);
    if (studentRow === -1) {
      notFound.push(code);
      return;
    }
    const name = masterSheet.getRange(studentRow, COL_STUDENT_NAME).getValue();
    awardPoint_(pointsSheet, todayStr, code, name, points, '入退くん引き継ぎ分');
    count++;
  });

  Logger.log(count + '件、ポイントを取り込みました。');
  if (notFound.length > 0) {
    Logger.log('見つからなかった生徒番号: ' + notFound.join(', '));
  }
}

/**
 * ===================================================================
 * 初回セットアップ関数（それぞれ1回だけ実行）
 * ===================================================================
 */
function setupQrColumn() {
  const sheet = getMasterSheet_();
  const header = sheet.getRange(1, COL_QR_DATA).getValue();
  if (!header) {
    sheet.getRange(1, COL_QR_DATA).setValue('QRデータ');
    Logger.log('AZ1に「QRデータ」の見出しを追加しました。');
  } else {
    Logger.log('AZ1には既に「' + header + '」という値が入っています。');
  }
}

function setupCheckInLogSheet() {
  getLogSheet_();
  getPointsSheet_();
  Logger.log('入退室ログのスプレッドシートID: ' + PropertiesService.getScriptProperties().getProperty('CHECKIN_LOG_SS_ID'));
}

/**
 * 現在のポイント設定を確認する
 */
function checkPointSettings() {
  Logger.log(JSON.stringify(getPointSettings_()));
  Logger.log('変更する場合は、スクリプトプロパティに POINTS_PER_VISIT / MIN_STAY_MINUTES を設定してください。');
}

/**
 * 動作確認用テスト（実際にQRデータを1つ指定して試す）
 */
function testCheckIn() {
  const result = handleCheckIn_('86188224121444524682906451', null);
  Logger.log(JSON.stringify(result));
}

