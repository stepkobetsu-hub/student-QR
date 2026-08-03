
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
const TEACHER_COL_QR = 17;   // Q列: QRナンバー

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
      result = { ok: true, service: 'STEP_MY_QR', status: 'ready' };
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
    if (isPointManagerApiAction_(body.action)) {
      result = handlePointManagerApiAction_(body);
    } else if (isMyQrApiAction_(body.action)) {
      result = handleMyQrApiAction_(body);
    } else if (isBrevoWebhookRequest_(e, body)) {
      result = handleBrevoWebhook_(body, rawBody);
    } else if (body.action === 'checkIn') {
      result = handleCheckIn_(body.qrData, body.photoBase64, body.receiptId, body.clientTimings, body.retry === true);
    } else if (body.action === 'getReceiptStatus') {
      result = getReceiptStatus_(body.receiptId);
    } else if (body.action === 'sendQrPdf') {
      result = sendQrPdfEmail_(body.code, body.toEmail, body.pdfBase64);
    } else if (isDeliveryFailureAdminAction_(body.action)) {
      result = handleDeliveryFailureAdminAction_(body);
    } else {
      result = { ok: false, message: '不明なアクションです: ' + body.action };
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
  const data = logSheet.getRange(2, 1, lastRow - 1, 4).getValues();

  // 日付ごと・生徒ごとの記録回数を集計
  const dailyCounts = {}; // { "2026-07-10|1001": 1 }
  data.forEach(row => {
    const ts = row[0];
    const code = String(row[1]).trim();
    if (!(ts instanceof Date)) return;
    if (code !== String(studentCode).trim()) return;
    const tsDate = Utilities.formatDate(ts, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (tsDate === todayStr) return; // 今日は対象外
    const key = tsDate;
    dailyCounts[key] = (dailyCounts[key] || 0) + 1;
  });

  const unclosedDates = Object.keys(dailyCounts).filter(d => dailyCounts[d] % 2 === 1).sort();
  if (unclosedDates.length === 0) return null;

  return unclosedDates[unclosedDates.length - 1]; // 直近の未退室日
}

function hasPointAwarded_(pointsSheet, studentCode, dateStr) {
  const lastRow = pointsSheet.getLastRow();
  if (lastRow < 2) return false;
  const data = pointsSheet.getRange(2, 1, lastRow - 1, 5).getValues(); // 日付, 生徒番号, 氏名, ポイント, 理由
  return data.some(row => {
    const d = row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[0]);
    const reason = String(row[4] || '');
    return d === dateStr && String(row[1]).trim() === String(studentCode).trim() && /^\[入退室\]/.test(reason);
  });
}

function awardPoint_(pointsSheet, dateStr, code, name, points, reason) {
  pointsSheet.appendRow([dateStr, code, name, points, reason]);
}

function getTotalPoints_(pointsSheet, studentCode) {
  const lastRow = pointsSheet.getLastRow();
  if (lastRow < 2) return 0;
  const data = pointsSheet.getRange(2, 2, lastRow - 1, 3).getValues(); // 生徒番号, 生徒氏名, ポイント
  let total = 0;
  data.forEach(row => {
    if (String(row[0]).trim() === String(studentCode).trim()) {
      total += Number(row[2]) || 0;
    }
  });
  return total;
}

/**
 * 生徒番号から現在の累計ポイントを取得（管理画面用）
 */
function getPointsInfo_(code) {
  if (!code) return { ok: false, message: '生徒番号を入力してください' };
  const masterSheet = getMasterSheet_();
  const row = findStudentRow_(masterSheet, code);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません' };

  const name = masterSheet.getRange(row, COL_STUDENT_NAME).getValue();
  const pointsSheet = getPointsSheet_();
  const total = getTotalPoints_(pointsSheet, code);

  return { ok: true, name: name, totalPoints: total };
}

/**
 * ポイントを手動で付与する（管理画面「ポイント付与」タブ用）
 * マイナスの値を渡せば減算（訂正）もできる
 */
function addManualPoints_(code, points, reason) {
  if (!code) return { ok: false, message: '生徒番号を入力してください' };
  const pointsNum = Number(points);
  if (!pointsNum || isNaN(pointsNum)) return { ok: false, message: 'ポイント数を正しく入力してください' };

  const masterSheet = getMasterSheet_();
  const row = findStudentRow_(masterSheet, code);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません' };

  const name = masterSheet.getRange(row, COL_STUDENT_NAME).getValue();
  const pointsSheet = getPointsSheet_();
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  awardPoint_(pointsSheet, todayStr, code, name, pointsNum, reason || '手動付与');

  const total = getTotalPoints_(pointsSheet, code);
  return { ok: true, name: name, totalPoints: total };
}

/**
 * 生徒のポイント履歴を取得する（新しい順、最大20件）
 */
function getPointsHistory_(code) {
  if (!code) return { ok: false, message: '生徒番号を入力してください' };
  const masterSheet = getMasterSheet_();
  const row = findStudentRow_(masterSheet, code);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません' };

  const name = masterSheet.getRange(row, COL_STUDENT_NAME).getValue();
  const pointsSheet = getPointsSheet_();
  const lastRow = pointsSheet.getLastRow();

  let history = [];
  let total = 0;
  if (lastRow >= 2) {
    const data = pointsSheet.getRange(2, 1, lastRow - 1, 5).getValues(); // 日付, 生徒番号, 生徒氏名, ポイント, 理由
    data.forEach(r => {
      if (String(r[1]).trim() === String(code).trim()) {
        const dateStr = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(r[0]);
        const pts = Number(r[3]) || 0;
        total += pts;
        history.push({ date: dateStr, points: pts, reason: r[4] || '' });
      }
    });
  }

  history.reverse(); // 新しい順
  if (history.length > 20) history = history.slice(0, 20);

  return { ok: true, name: name, totalPoints: total, history: history };
}

/**
 * 発行したQRカードをPDFにしてメールで送る
 */
function sendQrPdfEmail_(code, toEmail, pdfBase64) {
  if (!code || !toEmail || !pdfBase64) {
    return { ok: false, message: '生徒番号・送信先・PDFデータが必要です' };
  }
  const masterSheet = getMasterSheet_();
  const row = findStudentRow_(masterSheet, code);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません' };

  const name = masterSheet.getRange(row, COL_STUDENT_NAME).getValue();
  const subject = name + 'さんのQRコードのご案内';
  const htmlBody =
    '<p>' + name + 'さんの入退室用QRコードです。</p>' +
    '<p>添付のPDFを印刷してご利用ください。</p>' +
    '<hr>' +
    '<p style="font-size:12px;color:#888;">' + SCHOOL_DISPLAY_NAME + '</p>';

  const cleanBase64 = pdfBase64.replace(/^data:.*?;base64,/, '');

  try {
    const sent = sendEmailViaBrevo(toEmail, subject, htmlBody, {
      attachmentBase64: cleanBase64,
      attachmentName: name + '_QR.pdf',
      toName: name + '様'
    });
    if (!sent.accepted) return { ok: false, message: sent.error || 'メール送信に失敗しました' };
    return { ok: true, name: name };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * ===================================================================
 * 講師マスター 操作（勤怠管理用）
 * ===================================================================
 */

function getTeacherMasterSheet_() {
  return SpreadsheetApp.openById(TEACHER_SS_ID).getSheetByName(TEACHER_SHEET_NAME);
}

function findTeacherRowByQrData_(sheet, qrData) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, TEACHER_COL_QR, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(qrData).trim() !== '' && String(values[i][0]).trim() === String(qrData).trim()) {
      return i + 2;
    }
  }
  return -1;
}

function getTeacherLogSheet_() {
  const ss = getCheckInSpreadsheet_();
  let sheet = ss.getSheetByName('講師勤怠ログ');
  if (!sheet) {
    sheet = ss.insertSheet('講師勤怠ログ');
    sheet.appendRow(['タイムスタンプ', '講師コード', '氏名', '種別']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * その講師の「今日」の記録回数から、出勤／退勤を自動判定する
 */
function determineAttendanceType_(logSheet, teacherCode, todayStr) {
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return '出勤';

  const data = logSheet.getRange(2, 1, lastRow - 1, 2).getValues(); // タイムスタンプ, 講師コード
  let countToday = 0;
  data.forEach(row => {
    const ts = row[0];
    const code = row[1];
    if (!(ts instanceof Date)) return;
    const tsDate = Utilities.formatDate(ts, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (tsDate === todayStr && String(code).trim() === String(teacherCode).trim()) {
      countToday++;
    }
  });

  return (countToday % 2 === 0) ? '出勤' : '退勤';
}

/**
 * 講師の勤怠処理（handleCheckIn_から、生徒として見つからなかった場合に呼ばれる）
 */
function handleTeacherCheckIn_(teacherRow, teacherMasterSheet) {
  const code = teacherMasterSheet.getRange(teacherRow, TEACHER_COL_CODE).getValue();
  const name = teacherMasterSheet.getRange(teacherRow, TEACHER_COL_NAME).getValue();

  const logSheet = getTeacherLogSheet_();
  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const type = determineAttendanceType_(logSheet, code, todayStr);

  logSheet.appendRow([now, code, name, type]);

  const label = Utilities.formatDate(now, 'Asia/Tokyo', 'M月d日H時mm分');

  return {
    ok: true,
    isTeacher: true,
    name: name,
    type: type,
    label: label
  };
}

/**
 * ===================================================================
 * 入退室処理のメイン（タブレットから呼ばれる）
 * ===================================================================
 */
function handleCheckIn_(qrData, photoBase64, receiptId, clientTimings, isRetry) {
  const trace = createCheckInTrace_(receiptId);
  const qr = String(qrData || '').trim();
  const receipt = String(receiptId || '').trim();
  traceMark_(trace, 'appsScriptAccepted');

  if (!isValidReceiptId_(receipt)) return checkInFailure_('INVALID_RECEIPT_ID', '受付IDの形式が正しくありません', trace);
  if (!isValidCheckInQrFormat_(qr)) return checkInFailure_('INVALID_QR_FORMAT', 'QRの形式が正しくありません', trace);
  traceMark_(trace, 'qrValidation');

  const prior = getCachedReceiptStatus_(receipt) || (isRetry ? getReceiptStatus_(receipt, true) : null);
  if (prior && prior.attendanceSaved) {
    prior.duplicate = true;
    prior.code = 'ALREADY_PROCESSED';
    prior.message = 'すでに同じ受付を処理済みです';
    prior.timings = trace.steps;
    logCheckInTrace_(trace, prior, 'duplicate');
    return prior;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return checkInFailure_('BUSY', 'ただいま別の受付を保存中です。もう一度お試しください', trace);

  let attendance;
  let notifyEmails = [];
  let photoFileId = '';
  try {
    const repeated = getCachedReceiptStatus_(receipt) || (isRetry ? getReceiptStatus_(receipt, true) : null);
    if (repeated && repeated.attendanceSaved) {
      repeated.duplicate = true;
      repeated.code = 'ALREADY_PROCESSED';
      repeated.message = 'すでに同じ受付を処理済みです';
      repeated.timings = trace.steps;
      logCheckInTrace_(trace, repeated, 'duplicate-after-lock');
      return repeated;
    }

    const masterSheet = getMasterSheet_();
    const studentRow = findQrRowCached_(masterSheet, COL_QR_DATA, qr, 'student');
    if (studentRow !== -1) {
      const width = Math.max(masterSheet.getLastColumn(), 70);
      const values = masterSheet.getRange(studentRow, 1, 1, width).getValues()[0];
      traceMark_(trace, 'subjectLookup');
      notifyEmails = getNotifyEmailsFromValues_(values);
      attendance = saveStudentAttendance_(values, receipt, trace, notifyEmails.length > 0);
    } else {
      const teacherSheet = getTeacherMasterSheet_();
      const teacherRow = findQrRowCached_(teacherSheet, TEACHER_COL_QR, qr, 'teacher');
      if (teacherRow === -1) return checkInFailure_('TARGET_NOT_FOUND', '登録対象が見つかりません', trace);
      const teacherValues = teacherSheet.getRange(teacherRow, 1, 1, Math.max(teacherSheet.getLastColumn(), TEACHER_COL_QR)).getValues()[0];
      traceMark_(trace, 'subjectLookup');
      attendance = saveTeacherAttendance_(teacherValues, receipt, trace);
    }
  } catch (error) {
    console.error('check-in save failed', sanitizeCheckInError_(error));
    return checkInFailure_('SAVE_FAILED', '入退室記録の保存に失敗しました', trace);
  } finally {
    lock.releaseLock();
  }

  traceMark_(trace, 'attendanceSaved');
  let mailStatus = notifyEmails.length ? 'PENDING' : 'NOT_REQUIRED';
  cacheReceiptStatus_(Object.assign({}, attendance, { ok: true, code: 'ATTENDANCE_SAVED', attendanceSaved: true, mailStatus: mailStatus, duplicate: false }));
  if (notifyEmails.length) {
    if (!isCheckInMailConfigured_()) {
      mailStatus = 'FAILED';
      updateCheckInLogMailStatus_(receipt, '送信エラー', [], [], 'メール送信設定が未完了です');
      console.error('check-in mail queue skipped: mail settings are incomplete');
    } else {
      try {
        photoFileId = saveCheckInPhoto_(photoBase64, receipt);
        enqueueCheckInMail_(attendance, notifyEmails, photoFileId);
        traceMark_(trace, 'mailQueued');
      } catch (error) {
        mailStatus = 'FAILED';
        updateCheckInLogMailStatus_(receipt, '送信エラー', [], [], sanitizeCheckInError_(error));
        console.error('check-in mail queue failed', sanitizeCheckInError_(error));
      }
    }
  }

  const result = Object.assign({}, attendance, {
    ok: true,
    code: mailStatus === 'FAILED' ? 'MAIL_FAILED' : 'ATTENDANCE_SAVED',
    attendanceSaved: true,
    mailStatus: mailStatus,
    duplicate: false,
    timings: finishCheckInTrace_(trace),
    clientTimingsReceived: !!clientTimings
  });
  cacheReceiptStatus_(result);
  logCheckInTrace_(trace, result, 'complete');
  return result;
}

function saveStudentAttendance_(values, receiptId, trace, hasNotificationTargets) {
  const code = String(values[COL_STUDENT_ID - 1] || '').trim();
  const name = String(values[COL_STUDENT_NAME - 1] || '').trim();
  const school = String(values[COL_SCHOOL - 1] || '').trim();
  const logSheet = getLogSheet_();
  const logSchema = ensureCheckInLogSchema_(logSheet);
  const pointsSheet = getPointsSheet_();
  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const stateKey = dailyCheckInStateKey_('student', code, todayStr);
  const cache = CacheService.getScriptCache();
  let state = parseCheckInCache_(cache.get(stateKey));
  if (!state) {
    const logRows = logSheet.getLastRow() < 2 ? [] : logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 4).getValues();
    const pointRows = pointsSheet.getLastRow() < 2 ? [] : pointsSheet.getRange(2, 1, pointsSheet.getLastRow() - 1, 5).getValues();
    const todayRows = logRows.filter(row => row[0] instanceof Date && String(row[1]).trim() === code && Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') === todayStr);
    const entries = todayRows.filter(row => row[3] === '入室' && row[0] instanceof Date);
    state = {
      count: todayRows.length,
      lastEntryMs: entries.length ? entries[entries.length - 1][0].getTime() : 0,
      awarded: pointRows.some(row => {
        const date = row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[0]);
        return date === todayStr && String(row[1]).trim() === code && /^\[入退室\]/.test(String(row[4] || ''));
      }),
      totalPoints: pointRows.reduce((total, row) => String(row[1]).trim() === code ? total + (Number(row[3]) || 0) : total, 0)
    };
  }
  traceMark_(trace, 'attendanceDataRead');

  const type = state.count % 2 === 0 ? '入室' : '退室';
  const settings = getPointSettings_();
  const alreadyAwarded = !!state.awarded;
  traceMark_(trace, 'attendanceDecision');

  const newRow = new Array(logSchema.lastColumn).fill('');
  setByHeader_(newRow, logSchema.headers, 'タイムスタンプ', now);
  setByHeader_(newRow, logSchema.headers, '生徒番号', code);
  setByHeader_(newRow, logSchema.headers, '生徒氏名', name);
  setByHeader_(newRow, logSchema.headers, '種別', type);
  setByHeader_(newRow, logSchema.headers, '校舎', school);
  setByHeader_(newRow, logSchema.headers, 'メール送信結果', hasNotificationTargets ? '送信待ち' : '通知先なし');
  setByHeader_(newRow, logSchema.headers, '配信状態', hasNotificationTargets ? '送信待ち' : '通知先なし');
  setByHeader_(newRow, logSchema.headers, '送信元システム', 'QR_ATTENDANCE');
  setByHeader_(newRow, logSchema.headers, '送信種別', type);
  setByHeader_(newRow, logSchema.headers, '件名', type === '入室' ? '入室のお知らせ' : '退室のお知らせ');
  setByHeader_(newRow, logSchema.headers, CHECKIN_RECEIPT_HEADER, receiptId);
  setByHeader_(newRow, logSchema.headers, CHECKIN_TIMING_HEADER, JSON.stringify(trace.steps));
  const logRow = logSheet.getLastRow() + 1;
  logSheet.getRange(logRow, 1, 1, newRow.length).setValues([newRow]);

  let pointDelta = 0;
  if (settings.enabled && (settings.dailyLimit === 'none' || !alreadyAwarded)) {
    if (settings.timing === 'entry' && type === '入室') pointDelta = settings.perVisit;
    if (settings.timing === 'exit' && type === '退室') {
      if (state.lastEntryMs && Math.floor((now.getTime() - state.lastEntryMs) / 60000) >= settings.minMinutes) pointDelta = settings.perVisit;
    }
  }
  if (pointDelta) {
    const reason = type === '入室' ? '[入退室] 入室時付与' : '[入退室] 退室時付与';
    pointsSheet.getRange(pointsSheet.getLastRow() + 1, 1, 1, 5).setValues([[todayStr, code, name, pointDelta, reason]]);
  }
  state.count++;
  if (type === '入室') state.lastEntryMs = now.getTime();
  if (pointDelta) state.awarded = true;
  state.totalPoints = Number(state.totalPoints || 0) + pointDelta;
  cache.put(stateKey, JSON.stringify(state), 21600);
  const totalPoints = state.totalPoints;
  return { receiptId: receiptId, isTeacher: false, name: name, school: school, type: type, label: Utilities.formatDate(now, 'Asia/Tokyo', 'M月d日H時mm分'), totalPoints: totalPoints, logRow: logRow, maskedSubjectId: maskCheckInId_(code) };
}

function saveTeacherAttendance_(values, receiptId, trace) {
  const code = String(values[TEACHER_COL_CODE - 1] || '').trim();
  const name = String(values[TEACHER_COL_NAME - 1] || '').trim();
  const sheet = getTeacherLogSheet_();
  const schema = ensureHeaders_(sheet, ['タイムスタンプ','講師コード','氏名','種別','メール送信結果','送信先メール',CHECKIN_RECEIPT_HEADER,CHECKIN_TIMING_HEADER]);
  const now = new Date();
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const stateKey = dailyCheckInStateKey_('teacher', code, today);
  const cache = CacheService.getScriptCache();
  let state = parseCheckInCache_(cache.get(stateKey));
  if (!state) {
    const rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    state = { count: rows.filter(row => row[0] instanceof Date && String(row[1]).trim() === code && Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') === today).length };
  }
  traceMark_(trace, 'attendanceDataRead');
  const type = state.count % 2 === 0 ? '出勤' : '退勤';
  traceMark_(trace, 'attendanceDecision');
  const record = new Array(schema.lastColumn).fill('');
  setByHeader_(record, schema.headers, 'タイムスタンプ', now);
  setByHeader_(record, schema.headers, '講師コード', code);
  setByHeader_(record, schema.headers, '氏名', name);
  setByHeader_(record, schema.headers, '種別', type);
  setByHeader_(record, schema.headers, 'メール送信結果', '通知なし');
  setByHeader_(record, schema.headers, CHECKIN_RECEIPT_HEADER, receiptId);
  setByHeader_(record, schema.headers, CHECKIN_TIMING_HEADER, JSON.stringify(trace.steps));
  const row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, record.length).setValues([record]);
  state.count++;
  cache.put(stateKey, JSON.stringify(state), 21600);
  return { receiptId: receiptId, isTeacher: true, name: name, school: '', type: type, label: Utilities.formatDate(now, 'Asia/Tokyo', 'M月d日H時mm分'), totalPoints: null, logRow: row, maskedSubjectId: maskCheckInId_(code) };
}

function findQrRowCached_(sheet, column, qrData, kind) {
  const digest = shortCheckInHash_(qrData);
  const cache = CacheService.getScriptCache();
  const key = 'CHECKIN_QR_ROW_V1:' + kind + ':' + digest;
  const cached = Number(cache.get(key) || 0);
  if (cached >= 2 && String(sheet.getRange(cached, column).getValue()).trim() === qrData) return cached;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const match = sheet.getRange(2, column, lastRow - 1, 1).createTextFinder(qrData).matchEntireCell(true).findNext();
  if (!match) return -1;
  cache.put(key, String(match.getRow()), 21600);
  return match.getRow();
}

function ensureCheckInLogSchema_(sheet) {
  return ensureHeaders_(sheet, ['タイムスタンプ','生徒番号','生徒氏名','種別','校舎','メール送信結果','送信先メール','BrevoメッセージID','照合ID','配信状態','最終イベント日時','最終配信成功日時','最終エラー理由','配信状態更新日時','送信元システム','送信種別','件名','送信時結果',CHECKIN_RECEIPT_HEADER,CHECKIN_TIMING_HEADER]);
}

function ensureHeaders_(sheet, required) {
  const currentLast = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, currentLast).getValues()[0].map(String);
  const missing = required.filter(header => headers.indexOf(header) < 0);
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    missing.forEach(header => headers.push(header));
  }
  return { headers: headers, lastColumn: headers.length };
}

function setByHeader_(row, headers, header, value) {
  const index = headers.indexOf(header);
  if (index >= 0) row[index] = value;
}

function getReceiptStatus_(receiptId, skipCache) {
  const receipt = String(receiptId || '').trim();
  if (!isValidReceiptId_(receipt)) return { ok: false, code: 'RECEIPT_NOT_FOUND', attendanceSaved: false, mailStatus: 'NOT_STARTED', message: '受付情報が見つかりません' };
  if (!skipCache) {
    const cached = getCachedReceiptStatus_(receipt);
    if (cached) return cached;
  }
  const studentLog = getLogSheet_();
  const studentSchema = ensureCheckInLogSchema_(studentLog);
  const studentReceiptCol = studentSchema.headers.indexOf(CHECKIN_RECEIPT_HEADER) + 1;
  if (studentReceiptCol > 0 && studentLog.getLastRow() >= 2) {
    const match = studentLog.getRange(2, studentReceiptCol, studentLog.getLastRow() - 1, 1).createTextFinder(receipt).matchEntireCell(true).findNext();
    if (match) {
      const values = studentLog.getRange(match.getRow(), 1, 1, studentSchema.lastColumn).getValues()[0];
      const value = header => values[studentSchema.headers.indexOf(header)];
      const result = { ok: true, code: 'ATTENDANCE_SAVED', attendanceSaved: true, receiptId: receipt, isTeacher: false, name: value('生徒氏名'), school: value('校舎'), type: value('種別'), label: value('タイムスタンプ') instanceof Date ? Utilities.formatDate(value('タイムスタンプ'), 'Asia/Tokyo', 'M月d日H時mm分') : '', mailStatus: normalizeMailStatus_(value('配信状態')), duplicate: true, totalPoints: null };
      cacheReceiptStatus_(result);
      return result;
    }
  }
  const teacherLog = getTeacherLogSheet_();
  const teacherSchema = ensureHeaders_(teacherLog, ['タイムスタンプ','講師コード','氏名','種別','メール送信結果','送信先メール',CHECKIN_RECEIPT_HEADER,CHECKIN_TIMING_HEADER]);
  const teacherReceiptCol = teacherSchema.headers.indexOf(CHECKIN_RECEIPT_HEADER) + 1;
  if (teacherReceiptCol > 0 && teacherLog.getLastRow() >= 2) {
    const match = teacherLog.getRange(2, teacherReceiptCol, teacherLog.getLastRow() - 1, 1).createTextFinder(receipt).matchEntireCell(true).findNext();
    if (match) {
      const values = teacherLog.getRange(match.getRow(), 1, 1, teacherSchema.lastColumn).getValues()[0];
      const value = header => values[teacherSchema.headers.indexOf(header)];
      const result = { ok: true, code: 'ATTENDANCE_SAVED', attendanceSaved: true, receiptId: receipt, isTeacher: true, name: value('氏名'), school: '', type: value('種別'), label: value('タイムスタンプ') instanceof Date ? Utilities.formatDate(value('タイムスタンプ'), 'Asia/Tokyo', 'M月d日H時mm分') : '', mailStatus: 'NOT_REQUIRED', duplicate: true, totalPoints: null };
      cacheReceiptStatus_(result);
      return result;
    }
  }
  return { ok: false, code: 'RECEIPT_NOT_FOUND', attendanceSaved: false, mailStatus: 'NOT_STARTED', message: '受付情報が見つかりません' };
}

function normalizeMailStatus_(value) {
  const status = String(value || '');
  if (/送信完了|配信完了|送信受付|送信成功/.test(status)) return 'SENT';
  if (/送信エラー|送信失敗/.test(status)) return 'FAILED';
  if (/通知先なし|通知なし/.test(status)) return 'NOT_REQUIRED';
  return 'PENDING';
}

function receiptCacheKey_(receiptId) { return 'CHECKIN_RECEIPT_V1:' + shortCheckInHash_(receiptId); }
function getCachedReceiptStatus_(receiptId) { return parseCheckInCache_(CacheService.getScriptCache().get(receiptCacheKey_(receiptId))); }
function cacheReceiptStatus_(result) {
  if (!result || !result.receiptId || !result.attendanceSaved) return;
  CacheService.getScriptCache().put(receiptCacheKey_(result.receiptId), JSON.stringify(result), 21600);
}
function dailyCheckInStateKey_(kind, code, date) { return 'CHECKIN_DAY_V1:' + kind + ':' + shortCheckInHash_(code) + ':' + date; }
function parseCheckInCache_(raw) { if (!raw) return null; try { return JSON.parse(raw); } catch (ignore) { return null; } }

function getCheckInMailQueueSheet_() {
  const ss = getCheckInSpreadsheet_();
  let sheet = ss.getSheetByName(CHECKIN_MAIL_QUEUE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CHECKIN_MAIL_QUEUE_SHEET);
    sheet.getRange(1, 1, 1, CHECKIN_MAIL_QUEUE_HEADERS.length).setValues([CHECKIN_MAIL_QUEUE_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function isCheckInMailConfigured_() {
  const props = PropertiesService.getScriptProperties();
  return !!String(props.getProperty('BREVO_API_KEY') || '').trim()
    && !!String(props.getProperty('CHECKIN_FROM_EMAIL') || '').trim();
}

function enqueueCheckInMail_(attendance, emails, photoFileId) {
  const sheet = getCheckInMailQueueSheet_();
  const match = sheet.getLastRow() < 2 ? null : sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(attendance.receiptId).matchEntireCell(true).findNext();
  if (match) return;
  const recipients = emails.map(email => ({ email: email, status: 'PENDING', messageId: '', correlationId: '', error: '' }));
  const now = new Date();
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, CHECKIN_MAIL_QUEUE_HEADERS.length).setValues([[
    attendance.receiptId, now, now, 'PENDING', 0, now, '', attendance.name, attendance.type, now,
    JSON.stringify(recipients), photoFileId || '', '', '[]', '[]', '', attendance.logRow
  ]]);
}

function saveCheckInPhoto_(photoBase64, receiptId) {
  const raw = String(photoBase64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!raw) return '';
  const props = PropertiesService.getScriptProperties();
  let folderId = String(props.getProperty('CHECKIN_MAIL_PHOTO_FOLDER_ID') || '').trim();
  let folder;
  if (folderId) folder = DriveApp.getFolderById(folderId);
  else {
    folder = DriveApp.createFolder('入退室メール一時画像');
    folderId = folder.getId();
    props.setProperty('CHECKIN_MAIL_PHOTO_FOLDER_ID', folderId);
  }
  const blob = Utilities.newBlob(Utilities.base64Decode(raw), 'image/jpeg', 'checkin-' + receiptId + '.jpg');
  return folder.createFile(blob).getId();
}

function processCheckInMailQueue() {
  const queueLock = LockService.getUserLock();
  if (!queueLock.tryLock(100)) return { processed: 0, skipped: 'already_running' };
  try {
    const sheet = getCheckInMailQueueSheet_();
    if (sheet.getLastRow() < 2) return { processed: 0 };
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, CHECKIN_MAIL_QUEUE_HEADERS.length).getValues();
    let processed = 0;
    rows.forEach((row, index) => {
      if (processed >= 10) return;
      const status = String(row[3] || '');
      const nextAt = row[5] instanceof Date ? row[5].getTime() : 0;
      const staleProcessing = status === 'PROCESSING' && row[2] instanceof Date && Date.now() - row[2].getTime() > 10 * 60 * 1000;
      if (!['PENDING','RETRY'].includes(status) && !staleProcessing) return;
      if (nextAt > Date.now()) return;
      processCheckInMailQueueRow_(sheet, index + 2, row);
      processed++;
    });
    return { processed: processed };
  } finally {
    queueLock.releaseLock();
  }
}

function processCheckInMailQueueRow_(sheet, rowNumber, row) {
  const mailSendStartedAt = Date.now();
  const receiptId = String(row[0]);
  const attempts = Number(row[4] || 0) + 1;
  let recipients;
  try { recipients = JSON.parse(String(row[10] || '[]')); } catch (error) { recipients = []; }
  row[2] = new Date(); row[3] = 'PROCESSING'; row[4] = attempts;
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  let photo = '';
  if (row[11]) {
    try { photo = 'data:image/jpeg;base64,' + Utilities.base64Encode(DriveApp.getFileById(String(row[11])).getBlob().getBytes()); } catch (ignore) {}
  }
  recipients.forEach(recipient => {
    if (['SENT','STOPPED'].includes(recipient.status)) return;
    if (isDeliveryEmailStopped_(recipient.email)) {
      recipient.status = 'STOPPED'; recipient.error = '不達メールのため送信停止中'; return;
    }
    recipient.status = 'PROCESSING';
    row[10] = JSON.stringify(recipients); row[2] = new Date();
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    try {
      const sent = sendCheckInEmail_(String(row[7]), recipient.email, photo, String(row[8]), row[9] instanceof Date ? row[9] : new Date(), receiptId);
      recipient.status = sent && sent.accepted ? 'SENT' : 'FAILED';
      recipient.messageId = sent && sent.messageId || '';
      recipient.correlationId = sent && sent.correlationId || '';
      recipient.error = sent && sent.error || '';
    } catch (error) {
      recipient.status = 'FAILED'; recipient.error = sanitizeCheckInError_(error);
    }
    row[10] = JSON.stringify(recipients); row[2] = new Date();
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  });
  const pending = recipients.some(recipient => recipient.status === 'FAILED' || recipient.status === 'PROCESSING' || recipient.status === 'PENDING');
  const sent = recipients.filter(recipient => recipient.status === 'SENT');
  row[2] = new Date();
  row[3] = pending && attempts < CHECKIN_MAIL_MAX_ATTEMPTS ? 'RETRY' : (pending ? 'FAILED' : 'SENT');
  row[5] = row[3] === 'RETRY' ? new Date(Date.now() + attempts * 60000) : '';
  row[12] = recipients.filter(recipient => recipient.error).map(recipient => recipient.error).join(' / ');
  row[13] = JSON.stringify(sent.map(recipient => recipient.messageId).filter(Boolean));
  row[14] = JSON.stringify(sent.map(recipient => recipient.correlationId).filter(Boolean));
  row[15] = row[3] === 'SENT' ? new Date() : '';
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  const logStatus = row[3] === 'SENT' ? '送信完了' : (row[3] === 'FAILED' ? '送信エラー' : '送信待ち');
  updateCheckInLogMailStatus_(receiptId, logStatus, sent.map(r => r.messageId).filter(Boolean), sent.map(r => r.correlationId).filter(Boolean), row[12]);
  if (row[3] !== 'RETRY' && row[11]) try { DriveApp.getFileById(String(row[11])).setTrashed(true); } catch (ignore) {}
  console.log(JSON.stringify({ event: 'checkin_mail', receiptId: receiptId, status: row[3], attempts: attempts, mailSendMs: Date.now() - mailSendStartedAt, mailDelayMs: row[15] instanceof Date && row[1] instanceof Date ? row[15].getTime() - row[1].getTime() : null }));
}

function updateCheckInLogMailStatus_(receiptId, status, messageIds, correlationIds, errorText) {
  const sheet = getLogSheet_();
  const schema = ensureCheckInLogSchema_(sheet);
  const receiptCol = schema.headers.indexOf(CHECKIN_RECEIPT_HEADER) + 1;
  if (receiptCol < 1 || sheet.getLastRow() < 2) return;
  const match = sheet.getRange(2, receiptCol, sheet.getLastRow() - 1, 1).createTextFinder(receiptId).matchEntireCell(true).findNext();
  if (!match) return;
  const values = sheet.getRange(match.getRow(), 1, 1, schema.lastColumn).getValues()[0];
  setByHeader_(values, schema.headers, 'メール送信結果', status);
  setByHeader_(values, schema.headers, '配信状態', status);
  setByHeader_(values, schema.headers, 'BrevoメッセージID', JSON.stringify(messageIds || []));
  setByHeader_(values, schema.headers, '照合ID', JSON.stringify(correlationIds || []));
  setByHeader_(values, schema.headers, '最終エラー理由', String(errorText || '').slice(0, 500));
  setByHeader_(values, schema.headers, '配信状態更新日時', new Date());
  setByHeader_(values, schema.headers, '送信時結果', status);
  sheet.getRange(match.getRow(), 1, 1, values.length).setValues([values]);
  const cached = getCachedReceiptStatus_(receiptId);
  if (cached) {
    cached.mailStatus = normalizeMailStatus_(status);
    cached.code = cached.mailStatus === 'FAILED' ? 'MAIL_FAILED' : 'ATTENDANCE_SAVED';
    cacheReceiptStatus_(cached);
  }
}

function updateCheckInTiming_(attendance, timings) {
  const sheet = attendance.isTeacher ? getTeacherLogSheet_() : getLogSheet_();
  const schema = attendance.isTeacher
    ? ensureHeaders_(sheet, ['タイムスタンプ','講師コード','氏名','種別','メール送信結果','送信先メール',CHECKIN_RECEIPT_HEADER,CHECKIN_TIMING_HEADER])
    : ensureCheckInLogSchema_(sheet);
  if (!attendance.logRow || attendance.logRow > sheet.getLastRow()) return;
  const values = sheet.getRange(attendance.logRow, 1, 1, schema.lastColumn).getValues()[0];
  setByHeader_(values, schema.headers, CHECKIN_TIMING_HEADER, JSON.stringify(timings || {}));
  sheet.getRange(attendance.logRow, 1, 1, values.length).setValues([values]);
}

function setupCheckInMailQueue() {
  getCheckInMailQueueSheet_();
  ensureCheckInLogSchema_(getLogSheet_());
  ensureHeaders_(getTeacherLogSheet_(), ['タイムスタンプ','講師コード','氏名','種別','メール送信結果','送信先メール',CHECKIN_RECEIPT_HEADER,CHECKIN_TIMING_HEADER]);
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'processCheckInMailQueue');
  if (!exists) ScriptApp.newTrigger('processCheckInMailQueue').timeBased().everyMinutes(1).create();
  return { ok: true, triggerInstalled: !exists };
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
 * Brevo経由でのメール送信
 * ===================================================================
 */
function sendEmailViaBrevo(toEmail, subject, htmlBody, options) {
  options = options || {};

  const apiKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
  if (!apiKey) {
    throw new Error('BREVO_API_KEY がスクリプトプロパティに設定されていません');
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
    return { accepted: true, messageId: String(response.messageId || ''), acceptedAt: new Date(), error: '', httpStatus: code, correlationId: correlationId };
  }
  return { accepted: false, messageId: '', acceptedAt: new Date(), error: 'Brevo送信失敗 (' + code + '): ' + res.getContentText(), httpStatus: code, correlationId: correlationId };
}

/**
 * 入退室メールの文面（指定フォーマット通り）
 */
function sendCheckInEmail_(studentName, guardianEmail, photoBase64, type, now, receiptId) {
  const label = Utilities.formatDate(now, 'Asia/Tokyo', 'M月d日H時mm分');

  const subject = (type === '入室') ? '入室のお知らせ' : '退室のお知らせ';
  const bodyText = studentName + 'さんが' + SCHOOL_DISPLAY_NAME + 'に' + type + 'しました。\n' + label + '\n' + SCHOOL_DISPLAY_NAME;
  const htmlBody = bodyText.replace(/\n/g, '<br>');

  const options = {
    toName: studentName + '様 保護者',
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
