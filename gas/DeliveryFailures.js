/** Brevo Transactional Webhook / 不達メール管理 */
const DELIVERY_FAILURE_SHEET_NAME = '不達メール管理';
const DELIVERY_FAILURE_HEADERS = [
  '管理ID','イベント重複判定キー','発生日時','登録日時','メールアドレス','イベント種別','表示用状態',
  'BrevoメッセージID','照合ID','件名','理由','タグ','送信元','生徒番号','生徒氏名','校舎',
  '該当通知欄','該当生徒一覧','兄弟を含む関連生徒一覧','送信停止','確認状態','確認者','確認日時',
  '送信再開者','送信再開日時','本人確認済み','本人確認内容','最終配信成功日時','元JSON'
];
const DELIVERY_LOG_EXTRA_HEADERS = ['BrevoメッセージID','照合ID','配信状態','最終イベント日時','最終配信成功日時','最終エラー理由','配信状態更新日時'];
const BREVO_WEBHOOK_EVENTS = ['delivered','hard_bounce','soft_bounce','blocked','invalid_email','deferred','spam','complaint','error'];
const DELIVERY_IMMEDIATE_STOP_EVENTS = ['hard_bounce','blocked','invalid_email','spam'];
const DELIVERY_TEMP_EVENTS = ['soft_bounce','deferred','error'];
const DELIVERY_ADMIN_ACTIONS = ['deliveryFailuresList','deliveryFailureDetail','deliveryFailureConfirm','deliveryFailureResume','deliveryFailureStop','deliveryFailureSpamResume','deliveryFailureRelatedStudents','deliveryFailureBrevoUnblock'];

function normalizeDeliveryEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBrevoEvent_(value) {
  const key = String(value || '').trim().replace(/[\s-]/g, '_').toLowerCase();
  const aliases = {
    hardbounce: 'hard_bounce', softbounce: 'soft_bounce',
    invalid: 'invalid_email', invalidemail: 'invalid_email',
    complaint: 'spam'
  };
  return aliases[key] || key;
}

function ensureDeliveryLogColumns_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 7);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  DELIVERY_LOG_EXTRA_HEADERS.forEach(header => {
    if (headers.indexOf(header) < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      headers.push(header);
    }
  });
}

function getDeliveryFailureSheet_() {
  const ss = getCheckInSpreadsheet_();
  let sheet = ss.getSheetByName(DELIVERY_FAILURE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DELIVERY_FAILURE_SHEET_NAME);
    if (sheet.getMaxColumns() < DELIVERY_FAILURE_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), DELIVERY_FAILURE_HEADERS.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, DELIVERY_FAILURE_HEADERS.length).setValues([DELIVERY_FAILURE_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function isBrevoWebhookRequest_(e, body) {
  const props = PropertiesService.getScriptProperties();
  const expected = String(props.getProperty('BREVO_WEBHOOK_TOKEN') || '');
  const actual = String((e && e.parameter && e.parameter.brevoWebhookToken) || '');
  if (!expected || !constantTimeEquals_(expected, actual)) return false;
  return body && BREVO_WEBHOOK_EVENTS.indexOf(normalizeBrevoEvent_(body.event)) >= 0;
}

function constantTimeEquals_(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  return diff === 0;
}

function extractCorrelationId_(body) {
  const raw = String(body['X-Mailin-custom'] || body['x-mailin-custom'] || '');
  const match = raw.match(/(?:^|[|;,\s])correlation_id:([A-Za-z0-9-]+)/i);
  return match ? match[1] : '';
}

function findDeliveryLogRecord_(messageId, correlationId) {
  const sheet = getLogSheet_();
  if (sheet.getLastRow() < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const messageCol = headers.indexOf('BrevoメッセージID');
  const correlationCol = headers.indexOf('照合ID');
  if (messageCol < 0 || correlationCol < 0) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    const messageCell = String(values[i][messageCol] || '');
    const correlationCell = String(values[i][correlationCol] || '');
    if ((messageId && messageCell.indexOf(messageId) >= 0) || (correlationId && correlationCell.indexOf(correlationId) >= 0)) {
      return { sheet: sheet, row: i + 2, headers: headers, values: values[i] };
    }
  }
  return null;
}

function handleBrevoWebhook_(body, rawBody) {
  const event = normalizeBrevoEvent_(body.event);
  const email = normalizeDeliveryEmail_(body.email);
  const messageId = String(body['message-id'] || body.messageId || '');
  const correlationId = extractCorrelationId_(body);
  if (!email || (!messageId && !correlationId)) return { ok: false, message: '必須項目がありません' };
  const logRecord = findDeliveryLogRecord_(messageId, correlationId);
  if (!logRecord) return { ok: false, message: '実際の送信ログと照合できません' };
  const eventDate = deliveryEventDate_(body);
  const fallback = body.ts_event || body.ts || body.date || rawBody;
  const dedupeKey = deliveryHash_([messageId, event, fallback, email].join('|'));
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (deliveryDedupeExists_(dedupeKey)) return { ok: true, duplicate: true };
    updateDeliveryLogFromWebhook_(logRecord, event, eventDate, String(body.reason || body.error || ''));
    if (event === 'delivered') {
      updateDeliveredFailureRecords_(email, messageId, eventDate);
      return { ok: true, delivered: true };
    }
    const matches = findStudentsByDeliveryEmail_(email);
    const stopped = DELIVERY_IMMEDIATE_STOP_EVENTS.indexOf(event) >= 0 || shouldStopForTemporaryErrors_(email, messageId, event, eventDate);
    appendDeliveryFailure_(body, rawBody, dedupeKey, eventDate, correlationId, matches, stopped);
    return { ok: true, stopped: stopped };
  } finally {
    lock.releaseLock();
  }
}

function deliveryEventDate_(body) {
  const seconds = Number(body.ts_event || body.ts || 0);
  if (seconds) return new Date(seconds * 1000);
  const parsed = new Date(String(body.date || ''));
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function deliveryHash_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)).replace(/=+$/, '');
}

function deliveryDedupeExists_(key) {
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() < 2) return false;
  return sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().some(row => String(row[0]) === key);
}

function deliveryDisplayState_(event) {
  return ({ hard_bounce:'恒久不達', soft_bounce:'一時エラー', deferred:'一時エラー', blocked:'ブロック', invalid_email:'無効アドレス', spam:'迷惑メール報告', error:'送信エラー', delivered:'配信済み' })[event] || event;
}

function findStudentsByDeliveryEmail_(email) {
  const sheet = getMasterSheet_();
  if (sheet.getLastRow() < 2) return [];
  const lastCol = Math.max(sheet.getLastColumn(), 70);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  const result = [];
  data.forEach((row, idx) => {
    const cols = DELIVERY_EMAIL_COLS.concat(COL_NOTIFY_EMAILS);
    cols.forEach(col => {
      if (normalizeDeliveryEmail_(row[col - 1]) !== email) return;
      result.push({ row: idx + 2, id: String(row[COL_STUDENT_ID - 1] || ''), name: String(row[COL_STUDENT_NAME - 1] || ''), school: String(row[COL_SCHOOL - 1] || ''), field: deliveryEmailFieldName_(col) });
    });
  });
  return result;
}

function deliveryEmailFieldName_(col) {
  const index = DELIVERY_EMAIL_COLS.indexOf(col);
  if (index >= 0) return 'メール' + (index + 1);
  const legacy = COL_NOTIFY_EMAILS.indexOf(col);
  return legacy >= 0 ? '旧通知メール' + (legacy + 1) : '';
}

function appendDeliveryFailure_(body, rawBody, dedupeKey, eventDate, correlationId, matches, stopped) {
  const event = normalizeBrevoEvent_(body.event);
  const studentList = matches.map(m => m.id + ' ' + m.name + '（' + m.school + '）').join('\n');
  const fields = matches.map(m => m.id + ':' + m.field).join(', ');
  getDeliveryFailureSheet_().appendRow([
    Utilities.getUuid(), dedupeKey, eventDate, new Date(), normalizeDeliveryEmail_(body.email), event, deliveryDisplayState_(event),
    String(body['message-id'] || body.messageId || ''), correlationId, String(body.subject || ''), String(body.reason || body.error || ''),
    JSON.stringify(body.tags || []), DEFAULT_FROM_EMAIL, matches.map(m => m.id).join(', '), matches.map(m => m.name).join(', '),
    matches.map(m => m.school).join(', '), fields, studentList, studentList, stopped, '未確認', '', '', '', '', false, '', '', rawBody
  ]);
}

function updateDeliveryLogFromWebhook_(record, event, eventDate, reason) {
  const state = deliveryDisplayState_(event);
  const set = (header, value) => { const idx = record.headers.indexOf(header); if (idx >= 0) record.sheet.getRange(record.row, idx + 1).setValue(value); };
  set('配信状態', state); set('最終イベント日時', eventDate); set('配信状態更新日時', new Date());
  if (event === 'delivered') set('最終配信成功日時', eventDate);
  if (event !== 'delivered') set('最終エラー理由', reason);
}

function updateDeliveredFailureRecords_(email, messageId, deliveredAt) {
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
  let permanentStopExists = false;
  values.forEach(row => {
    if (normalizeDeliveryEmail_(row[4]) === email && DELIVERY_IMMEDIATE_STOP_EVENTS.indexOf(String(row[5])) >= 0 && (row[19] === true || String(row[19]).toUpperCase() === 'TRUE')) permanentStopExists = true;
  });
  values.forEach((row, i) => {
    if (normalizeDeliveryEmail_(row[4]) !== email) return;
    sheet.getRange(i + 2, 28).setValue(deliveredAt);
    if (!permanentStopExists && DELIVERY_TEMP_EVENTS.indexOf(String(row[5])) >= 0) sheet.getRange(i + 2, 20).setValue(false);
  });
}

function shouldStopForTemporaryErrors_(email, messageId, event, eventDate) {
  if (DELIVERY_TEMP_EVENTS.indexOf(event) < 0) return false;
  const props = PropertiesService.getScriptProperties();
  const threshold = Number(props.getProperty('BREVO_TEMP_ERROR_THRESHOLD')) || 3;
  const days = Number(props.getProperty('BREVO_TEMP_ERROR_WINDOW_DAYS')) || 7;
  const since = new Date(eventDate.getTime() - days * 86400000);
  const sheet = getDeliveryFailureSheet_();
  const ids = {};
  if (sheet.getLastRow() >= 2) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
    let resetAt = since;
    rows.forEach(row => {
      if (normalizeDeliveryEmail_(row[4]) === email && row[27]) { const d = row[27] instanceof Date ? row[27] : new Date(row[27]); if (d > resetAt) resetAt = d; }
    });
    rows.forEach(row => {
      const occurred = row[2] instanceof Date ? row[2] : new Date(row[2]);
      if (normalizeDeliveryEmail_(row[4]) === email && DELIVERY_TEMP_EVENTS.indexOf(String(row[5])) >= 0 && occurred >= resetAt) ids[String(row[7] || row[8] || row[1])] = true;
    });
  }
  ids[messageId] = true;
  return Object.keys(ids).length >= threshold;
}

function isDeliveryEmailStopped_(email) {
  const normalized = normalizeDeliveryEmail_(email);
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() < 2) return false;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
  for (let i = values.length - 1; i >= 0; i--) if (normalizeDeliveryEmail_(values[i][4]) === normalized) return values[i][19] === true || String(values[i][19]).toUpperCase() === 'TRUE';
  return false;
}

function isDeliveryFailureAdminAction_(action) { return DELIVERY_ADMIN_ACTIONS.indexOf(String(action || '')) >= 0; }

function verifyDeliveryStaff_(body, allowedLevels) {
  const code = String(body.staffCode || body.code || '').trim();
  const password = String(body.staffPassword || body.password || '');
  const sheet = SpreadsheetApp.openById(TEACHER_SS_ID).getSheetByName(TEACHER_SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() !== code) continue;
    const saved = String(rows[i][35] || '');
    const level = String(rows[i][36] || '').trim();
    if (saved && saved !== password) throw new Error('パスワードが違います');
    if (allowedLevels.indexOf(level) < 0) throw new Error('この操作を行う権限がありません');
    return { code: code, name: String(rows[i][1] || ''), level: level };
  }
  throw new Error('スタッフ認証に失敗しました');
}

function handleDeliveryFailureAdminAction_(body) {
  const action = String(body.action || '');
  const viewLevels = ['1','2','3','4'];
  if (action === 'deliveryFailureResume') return deliveryFailureResume_(body, false);
  if (action === 'deliveryFailureSpamResume' || action === 'deliveryFailureBrevoUnblock') return deliveryFailureResume_(body, true);
  const staff = verifyDeliveryStaff_(body, viewLevels);
  if (action === 'deliveryFailuresList') return { ok:true, items:listDeliveryFailures_(body), staff:{name:staff.name,level:staff.level} };
  if (action === 'deliveryFailureDetail') return { ok:true, item:getDeliveryFailureById_(body.id) };
  if (action === 'deliveryFailureRelatedStudents') return { ok:true, students:findStudentsByDeliveryEmail_(normalizeDeliveryEmail_(body.email)) };
  if (action === 'deliveryFailureConfirm') return updateDeliveryFailureAction_(body.id, {20:'確認済み',21:staff.name,22:new Date()});
  if (action === 'deliveryFailureStop') return setDeliveryStopForEmail_(body.id, true, staff);
  throw new Error('不明な管理操作です');
}

function listDeliveryFailures_(filter) {
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues().map(deliveryRowToObject_).filter(item => {
    const emailQ = normalizeDeliveryEmail_(filter.emailSearch); const studentQ = String(filter.studentSearch || '').trim().toLowerCase();
    if (emailQ && item.email.indexOf(emailQ) < 0) return false;
    if (studentQ && (item.studentIds + ' ' + item.studentNames).toLowerCase().indexOf(studentQ) < 0) return false;
    if (filter.school && item.school.indexOf(String(filter.school)) < 0) return false;
    if (filter.state && item.state !== filter.state) return false;
    if (filter.unconfirmedOnly && item.confirmStatus === '確認済み') return false;
    if (filter.stoppedOnly && !item.stopped) return false;
    return true;
  }).reverse();
}

function deliveryRowToObject_(row) {
  return { id:String(row[0]), occurredAt:row[2], registeredAt:row[3], email:normalizeDeliveryEmail_(row[4]), event:String(row[5]), state:String(row[6]), messageId:String(row[7]), correlationId:String(row[8]), subject:String(row[9]), reason:String(row[10]), tags:String(row[11]), sender:String(row[12]), studentIds:String(row[13]), studentNames:String(row[14]), school:String(row[15]), fields:String(row[16]), students:String(row[17]), relatedStudents:String(row[18]), stopped:row[19] === true || String(row[19]).toUpperCase()==='TRUE', confirmStatus:String(row[20]), confirmer:String(row[21]), confirmedAt:row[22], resumedBy:String(row[23]), resumedAt:row[24], guardianConfirmed:row[25] === true || String(row[25]).toUpperCase()==='TRUE', guardianConfirmation:String(row[26]), deliveredAt:row[27], rawJson:String(row[28]) };
}

function getDeliveryFailureById_(id) {
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() < 2) throw new Error('対象が見つかりません');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]) === String(id)) return Object.assign(deliveryRowToObject_(rows[i]), { row:i + 2 });
  throw new Error('対象が見つかりません');
}

function updateDeliveryFailureAction_(id, valuesByZeroIndex) {
  const item = getDeliveryFailureById_(id); const sheet = getDeliveryFailureSheet_();
  Object.keys(valuesByZeroIndex).forEach(key => sheet.getRange(item.row, Number(key) + 1).setValue(valuesByZeroIndex[key]));
  return { ok:true };
}

function setDeliveryStopForEmail_(id, stopped, staff) {
  const item = getDeliveryFailureById_(id); const sheet = getDeliveryFailureSheet_();
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
  rows.forEach((row, i) => { if (normalizeDeliveryEmail_(row[4]) === item.email) sheet.getRange(i + 2, 20).setValue(stopped); });
  return { ok:true, stopped:stopped };
}

function deliveryFailureResume_(body, spamMode) {
  const levels = spamMode ? ['4'] : ['2','3','4'];
  const staff = verifyDeliveryStaff_(body, levels);
  const item = getDeliveryFailureById_(body.id);
  const isSpam = item.event === 'spam' || item.state === '迷惑メール報告';
  if (isSpam && !spamMode) throw new Error('迷惑メール報告は本人確認付きの専用操作が必要です');
  if (spamMode) {
    if (!body.guardianConfirmed || !String(body.confirmationDetails || '').trim()) throw new Error('保護者本人への確認と確認内容が必要です');
  }
  if (['hard_bounce','blocked','invalid_email','spam'].indexOf(item.event) >= 0) {
    if (staff.level !== '4') throw new Error('Brevoブロック解除を伴うためAK=4が必要です');
    unblockBrevoTransactionalContact_(item.email);
  }
  setDeliveryStopForEmail_(body.id, false, staff);
  const updates = {23:staff.name,24:new Date()};
  if (spamMode) { updates[25] = true; updates[26] = String(body.confirmationDetails).trim(); updates[20] = '確認済み'; updates[21] = staff.name; updates[22] = new Date(); }
  updateDeliveryFailureAction_(body.id, updates);
  return { ok:true, stopped:false };
}

function unblockBrevoTransactionalContact_(email) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
  if (!apiKey) throw new Error('BREVO_API_KEYが未設定です');
  const response = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/blockedContacts/' + encodeURIComponent(email), { method:'delete', headers:{'api-key':apiKey,'accept':'application/json'}, muteHttpExceptions:true });
  const status = response.getResponseCode();
  if (status !== 204 && status !== 200 && status !== 404) throw new Error('Brevoブロック解除に失敗しました (' + status + ')');
  return true;
}

function setupDeliveryFailureManagement() {
  getDeliveryFailureSheet_(); ensureDeliveryLogColumns_(getLogSheet_());
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('BREVO_TEMP_ERROR_THRESHOLD')) props.setProperty('BREVO_TEMP_ERROR_THRESHOLD','3');
  if (!props.getProperty('BREVO_TEMP_ERROR_WINDOW_DAYS')) props.setProperty('BREVO_TEMP_ERROR_WINDOW_DAYS','7');
  if (!props.getProperty('BREVO_WEBHOOK_TOKEN')) props.setProperty('BREVO_WEBHOOK_TOKEN', Utilities.getUuid() + Utilities.getUuid().replace(/-/g,''));
  Logger.log('不達メール管理の初期設定が完了しました。Webhook URLのトークンはスクリプトプロパティで確認してください。');
}
