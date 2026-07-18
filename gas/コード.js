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

const DEFAULT_FROM_EMAIL = 'admin@educrest.jp';
const DEFAULT_FROM_NAME  = 'Step個別指導ステップ';
const SCHOOL_DISPLAY_NAME = '個別指導ステップ';

/**
 * ===================================================================
 * エントリーポイント
 * ===================================================================
 */

// 管理画面（生徒QR登録）からのJSONPリクエスト用
function doGet(e) {
  const action = e.parameter.action;
  const callback = e.parameter.callback;
  let result;

  try {
    if (action === 'getStudent') {
      result = getStudent_(e.parameter.code);
    } else if (action === 'saveQrData') {
      result = saveStudentQrData_(e.parameter.code, e.parameter.qrData);
    } else if (action === 'issueNewQr') {
      result = issueNewStudentQr_(e.parameter.code);
    } else if (action === 'getNotifyEmails') {
      result = getNotifyEmails_(e.parameter.code);
    } else if (action === 'saveNotifyEmails') {
      const emails = JSON.parse(e.parameter.emails || '[]');
      result = saveNotifyEmails_(e.parameter.code, emails);
    } else if (action === 'getPointsInfo') {
      result = getPointsInfo_(e.parameter.code);
    } else if (action === 'addPoints') {
      result = addManualPoints_(e.parameter.code, e.parameter.points, e.parameter.reason);
    } else if (action === 'getPointsHistory') {
      result = getPointsHistory_(e.parameter.code);
    } else {
      result = { ok: false, message: '不明なアクションです: ' + action };
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
  let result;
  try {
    const rawBody = e && e.postData ? String(e.postData.contents || '') : '';
    const body = JSON.parse(rawBody || '{}');
    if (isBrevoWebhookRequest_(e, body)) {
      result = handleBrevoWebhook_(body, rawBody);
    } else if (body.action === 'checkIn') {
      result = handleCheckIn_(body.qrData, body.photoBase64);
    } else if (body.action === 'sendQrPdf') {
      result = sendQrPdfEmail_(body.code, body.toEmail, body.pdfBase64);
    } else if (isDeliveryFailureAdminAction_(body.action)) {
      result = handleDeliveryFailureAdminAction_(body);
    } else {
      result = { ok: false, message: '不明なアクションです: ' + body.action };
    }
  } catch (err) {
    result = { ok: false, message: err.message };
  }
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

// このメールアドレスに、入退室ログのスプレッドシートを自動共有します
const SHARE_WITH_EMAILS = [
  'stepkobetsu@gmail.com',
  'mintcocoajasmine@gmail.com',
  'chloeandnina1@gmail.com'
];

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
  SHARE_WITH_EMAILS.forEach(email => {
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
  const perVisit = Number(props.getProperty('POINTS_PER_VISIT')) || 1;
  const minMinutes = Number(props.getProperty('MIN_STAY_MINUTES')) || 10;
  return { perVisit, minMinutes };
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
  const data = pointsSheet.getRange(2, 1, lastRow - 1, 2).getValues(); // 日付, 生徒番号
  return data.some(row => {
    const d = row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[0]);
    return d === dateStr && String(row[1]).trim() === String(studentCode).trim();
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
function handleCheckIn_(qrData, photoBase64) {
  if (!qrData) return { ok: false, message: 'QRデータがありません' };

  const masterSheet = getMasterSheet_();
  const row = findStudentRowByQrData_(masterSheet, qrData);

  if (row === -1) {
    // 生徒として見つからない場合、講師マスターを確認する
    const teacherMasterSheet = getTeacherMasterSheet_();
    const teacherRow = findTeacherRowByQrData_(teacherMasterSheet, qrData);
    if (teacherRow !== -1) {
      return handleTeacherCheckIn_(teacherRow, teacherMasterSheet);
    }
    return { ok: false, message: '登録されていないQRコードです。管理者にご連絡ください。' };
  }

  const code = masterSheet.getRange(row, COL_STUDENT_ID).getValue();
  const name = masterSheet.getRange(row, COL_STUDENT_NAME).getValue();
  const school = masterSheet.getRange(row, COL_SCHOOL).getValue();
  const notifyEmails = getNotifyEmailsForRow_(masterSheet, row);

  const logSheet = getLogSheet_();
  const pointsSheet = getPointsSheet_();
  const settings = getPointSettings_();

  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');

  // ① 退室せずに日をまたいだ生徒がいれば、来塾した事実に対して1ポイント遡って付与
  const unclosedDate = findUnclosedPreviousSession_(logSheet, code, todayStr);
  if (unclosedDate && !hasPointAwarded_(pointsSheet, code, unclosedDate)) {
    awardPoint_(pointsSheet, unclosedDate, code, name, settings.perVisit, '退室未記録（来塾のみで付与）');
  }

  // ② 今回が入室か退室かを判定
  const type = determineCheckType_(logSheet, code, todayStr);

  // ③ 退室の場合、当日の滞在時間を計算してポイント判定
  if (type === '退室' && !hasPointAwarded_(pointsSheet, code, todayStr)) {
    const checkInTime = findLastCheckInToday_(logSheet, code, todayStr);
    if (checkInTime) {
      const stayMinutes = Math.floor((now.getTime() - checkInTime.getTime()) / 60000);
      if (stayMinutes >= settings.minMinutes) {
        awardPoint_(pointsSheet, todayStr, code, name, settings.perVisit, `退室（滞在${stayMinutes}分）`);
      }
    }
  }

  // ④ メール送信
  let successCount = 0;
  let stoppedCount = 0;
  let errorMessages = [];
  const sendRecords = [];
  if (notifyEmails.length > 0) {
    notifyEmails.forEach(email => {
      if (isDeliveryEmailStopped_(email)) {
        stoppedCount++;
        errorMessages.push(email + ': 不達メールのため送信停止中');
        sendRecords.push({ email: email, status: '不達メールのため送信停止中' });
        return;
      }
      try {
        const sent = sendCheckInEmail_(name, email, photoBase64, type, now);
        if (sent && sent.accepted) successCount++;
        else errorMessages.push(email + ': ' + ((sent && sent.error) || '送信エラー'));
        sendRecords.push(Object.assign({ email: email }, sent || {}));
      } catch (err) {
        errorMessages.push(email + ': ' + err.message);
        sendRecords.push({ email: email, accepted: false, error: err.message, status: '送信エラー' });
      }
    });
  } else {
    errorMessages.push('通知先メールが未登録です');
  }
  const mailResult = successCount > 0;

  // ⑤ ログ記録
  logSheet.appendRow([
    now,
    code,
    name,
    type,
    school,
    mailResult ? `送信成功(${successCount}/${notifyEmails.length}件)` : (stoppedCount === notifyEmails.length ? '不達メールのため送信停止中' : ('送信失敗: ' + errorMessages.join(' / '))),
    notifyEmails.join(', '),
    JSON.stringify(sendRecords.filter(r => r.messageId).map(r => r.messageId)),
    JSON.stringify(sendRecords.filter(r => r.correlationId).map(r => r.correlationId)),
    mailResult ? '送信受付' : (stoppedCount === notifyEmails.length ? '不達メールのため送信停止中' : '送信エラー'),
    '', '',
    errorMessages.join(' / '),
    new Date()
  ]);

  const totalPoints = getTotalPoints_(pointsSheet, code);
  const label = Utilities.formatDate(now, 'Asia/Tokyo', 'M月d日H時mm分');

  return {
    ok: true,
    name: name,
    school: school,
    type: type,
    label: label,
    mailSent: mailResult,
    totalPoints: totalPoints
  };
}

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
      email: options.fromEmail || DEFAULT_FROM_EMAIL
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
function sendCheckInEmail_(studentName, guardianEmail, photoBase64, type, now) {
  const label = Utilities.formatDate(now, 'Asia/Tokyo', 'M月d日H時mm分');

  const subject = (type === '入室') ? '入室のお知らせ' : '退室のお知らせ';
  const bodyText = studentName + 'さんが' + SCHOOL_DISPLAY_NAME + 'に' + type + 'しました。\n' + label + '\n' + SCHOOL_DISPLAY_NAME;
  const htmlBody = bodyText.replace(/\n/g, '<br>');

  const options = {
    toName: studentName + '様 保護者',
    tags: ['student-qr', type === '入室' ? 'checkin' : 'checkout']
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
