/** Brevo Transactional Webhook / 不達メール管理 */
const DELIVERY_FAILURE_SHEET_NAME = '不達メール管理';
const DELIVERY_FAILURE_HEADERS = [
  '管理ID','イベント重複判定キー','発生日時','登録日時','メールアドレス','イベント種別','表示用状態',
  'BrevoメッセージID','照合ID','件名','理由','タグ','送信元','生徒番号','生徒氏名','校舎',
  '該当通知欄','該当生徒一覧','兄弟を含む関連生徒一覧','送信停止','確認状態','確認者','確認日時',
  '送信再開者','送信再開日時','本人確認済み','本人確認内容','最終配信成功日時','元JSON',
  '送信元システム','初回発生日時','最終発生日時','発生回数','再送日時','管理者通知済み','管理者通知日時',
  'アーカイブ状態','アーカイブ日時','アーカイブ実行者'
];
const DELIVERY_FAILURE_ADMIN_EMAIL = 'mintcocoajasmine@gmail.com';
const DELIVERY_LOG_EXTRA_HEADERS = ['BrevoメッセージID','照合ID','配信状態','最終イベント日時','最終配信成功日時','最終エラー理由','配信状態更新日時'];
const BREVO_WEBHOOK_EVENTS = ['delivered','hard_bounce','soft_bounce','blocked','invalid_email','deferred','spam','complaint','error'];
const DELIVERY_IMMEDIATE_STOP_EVENTS = ['hard_bounce','blocked','invalid_email','spam'];
const DELIVERY_TEMP_EVENTS = ['soft_bounce','deferred','error'];
const DELIVERY_ADMIN_ACTIONS = ['deliveryFailuresList','deliveryFailureSummary','deliveryFailureDetail','deliveryFailureConfirm','deliveryFailureArchive','deliveryFailureUnarchive','deliveryFailureDeletePermanent','deliveryFailureResume','deliveryFailureStop','deliveryFailureSpamResume','deliveryFailureRelatedStudents','deliveryFailureBrevoUnblock'];
const WEBHOOK_DIAGNOSTIC_SHEET_NAME = 'Webhook診断';
const WEBHOOK_DIAGNOSTIC_HEADERS = ['受信日時','tokenMatched','event','recipient','messageId','messageId取得元','照合結果','処理結果','エラー概要'];

function normalizeDeliveryEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBrevoMessageId_(value) {
  return String(value || '').trim().replace(/^<+|>+$/g, '').trim().toLowerCase();
}

function extractBrevoMessageIdInfo_(body) {
  const keys = ['message-id', 'messageId', 'message_id'];
  for (let i = 0; i < keys.length; i++) {
    if (body && body[keys[i]] != null && String(body[keys[i]]).trim()) {
      return { value: normalizeBrevoMessageId_(body[keys[i]]), source: keys[i] };
    }
  }
  return { value: '', source: '' };
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

function getDeliveryFailureSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(
    props.getProperty('DELIVERY_FAILURE_SS_ID') ||
    props.getProperty('CHECKIN_LOG_SS_ID') ||
    ''
  ).trim();
  if (!spreadsheetId) {
    throw new Error('DELIVERY_FAILURE_SS_ID または CHECKIN_LOG_SS_ID が設定されていません。');
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

function getDeliveryFailureLogSheet_() {
  const sheet = getDeliveryFailureSpreadsheet_().getSheetByName('ログ');
  if (!sheet) throw new Error('不達管理用スプレッドシートに既存の「ログ」シートが見つかりません');
  return sheet;
}

function getDeliveryFailureSheet_() {
  const ss = getDeliveryFailureSpreadsheet_();
  const sheet = ss.getSheetByName(DELIVERY_FAILURE_SHEET_NAME);
  if (!sheet) throw new Error('既存の「' + DELIVERY_FAILURE_SHEET_NAME + '」シートが見つかりません');
  if (sheet.getMaxColumns() < DELIVERY_FAILURE_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), DELIVERY_FAILURE_HEADERS.length - sheet.getMaxColumns());
  const headers = sheet.getRange(1, 1, 1, DELIVERY_FAILURE_HEADERS.length).getValues()[0].map(String);
  DELIVERY_FAILURE_HEADERS.forEach((header, index) => { if (!headers[index]) sheet.getRange(1, index + 1).setValue(header); });
  return sheet;
}

function getWebhookDiagnosticSheet_() {
  const ss = getDeliveryFailureSpreadsheet_();
  let sheet = ss.getSheetByName(WEBHOOK_DIAGNOSTIC_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(WEBHOOK_DIAGNOSTIC_SHEET_NAME);
    sheet.getRange(1, 1, 1, WEBHOOK_DIAGNOSTIC_HEADERS.length).setValues([WEBHOOK_DIAGNOSTIC_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function setupWebhookDiagnostics() {
  getWebhookDiagnosticSheet_();
  return { ok: true };
}

function isWebhookDiagnosticEnabled_() {
  return String(PropertiesService.getScriptProperties().getProperty('WEBHOOK_DIAGNOSTIC') || 'false').trim().toLowerCase() === 'true';
}

function webhookTokenMatched_(e) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('BREVO_WEBHOOK_TOKEN') || '');
  const actual = String((e && e.parameter && e.parameter.brevoWebhookToken) || '');
  return Boolean(expected) && constantTimeEquals_(expected, actual);
}

function isBrevoWebhookCandidate_(e, body) {
  const hasTokenParameter = Boolean(e && e.parameter && Object.prototype.hasOwnProperty.call(e.parameter, 'brevoWebhookToken'));
  if (hasTokenParameter) return true;
  if (!body || typeof body !== 'object') return false;
  const idInfo = extractBrevoMessageIdInfo_(body);
  return Boolean(body.event && body.email && (idInfo.value || extractCorrelationId_(body)));
}

function beginWebhookDiagnostic_(e, body, parseSucceeded) {
  if (!isWebhookDiagnosticEnabled_()) return null;
  const idInfo = extractBrevoMessageIdInfo_(body || {});
  const sheet = getWebhookDiagnosticSheet_();
  const row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, WEBHOOK_DIAGNOSTIC_HEADERS.length).setValues([[
    new Date(), webhookTokenMatched_(e), normalizeBrevoEvent_((body || {}).event),
    normalizeDeliveryEmail_((body || {}).email), idInfo.value, idInfo.source,
    '未照合', '受信', parseSucceeded ? '' : 'JSON.parse失敗'
  ]]);
  return { sheet: sheet, row: row };
}

function updateWebhookDiagnostic_(diagnostic, values) {
  if (!diagnostic) return;
  const indexes = { tokenMatched:2, event:3, recipient:4, messageId:5, messageIdSource:6, matched:7, result:8, error:9 };
  Object.keys(values || {}).forEach(function(key) {
    if (indexes[key]) diagnostic.sheet.getRange(diagnostic.row, indexes[key]).setValue(values[key]);
  });
}

function isBrevoWebhookRequest_(e, body) {
  if (!webhookTokenMatched_(e)) return false;
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

function normalizedMessageIdsFromLogCell_(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(normalizeBrevoMessageId_).filter(Boolean);
  } catch (ignore) {}
  return [normalizeBrevoMessageId_(raw)].filter(Boolean);
}

function findDeliveryLogRecord_(messageId, correlationId) {
  const sheet = getDeliveryFailureLogSheet_();
  if (sheet.getLastRow() < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const messageCol = headers.indexOf('BrevoメッセージID');
  const correlationCol = headers.indexOf('照合ID');
  if (messageCol < 0 || correlationCol < 0) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const normalizedMessageId = normalizeBrevoMessageId_(messageId);
  for (let i = values.length - 1; i >= 0; i--) {
    const messageIds = normalizedMessageIdsFromLogCell_(values[i][messageCol]);
    const correlationCell = String(values[i][correlationCol] || '');
    if ((normalizedMessageId && messageIds.indexOf(normalizedMessageId) >= 0) || (correlationId && correlationCell.indexOf(correlationId) >= 0)) {
      return { sheet: sheet, row: i + 2, headers: headers, values: values[i] };
    }
  }
  return null;
}

function handleBrevoWebhook_(body, rawBody, diagnostic) {
  const event = normalizeBrevoEvent_(body.event);
  const email = normalizeDeliveryEmail_(body.email);
  const messageIdInfo = extractBrevoMessageIdInfo_(body);
  const messageId = messageIdInfo.value;
  const correlationId = extractCorrelationId_(body);
  updateWebhookDiagnostic_(diagnostic, { event:event, recipient:email, messageId:messageId, messageIdSource:messageIdInfo.source });
  if (!email || (!messageId && !correlationId)) {
    updateWebhookDiagnostic_(diagnostic, { matched:'照合不可', result:'処理終了', error:'必須項目なし' });
    return { ok: false, message: '必須項目がありません' };
  }
  const logRecord = findDeliveryLogRecord_(messageId, correlationId);
  if (!logRecord) {
    updateWebhookDiagnostic_(diagnostic, { matched:'messageId一致なし', result:'HTTP 200で終了', error:'' });
    return { ok: true, matched: false, message: '実際の送信ログと照合できません' };
  }
  updateWebhookDiagnostic_(diagnostic, { matched:'ログ' + logRecord.row + '行目' });
  const eventDate = deliveryEventDate_(body);
  const fallback = body.ts_event || body.ts || body.date || rawBody;
  const dedupeKey = deliveryHash_([messageId, event, fallback, email].join('|'));
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (deliveryDedupeExists_(dedupeKey)) {
      updateWebhookDiagnostic_(diagnostic, { result:'重複イベント', error:'' });
      return { ok: true, duplicate: true };
    }
    updateDeliveryLogFromWebhook_(logRecord, event, eventDate, String(body.reason || body.error || ''));
    if (event === 'delivered') {
      updateDeliveredFailureRecords_(email, messageId, eventDate, logRecord);
      updateWebhookDiagnostic_(diagnostic, { result:'配信完了へ更新', error:'' });
      return { ok: true, delivered: true };
    }
    const matches = findStudentsByDeliveryEmail_(email);
    const stopped = DELIVERY_IMMEDIATE_STOP_EVENTS.indexOf(event) >= 0 || shouldStopForTemporaryErrors_(email, messageId, event, eventDate);
    const upsertResult = appendDeliveryFailure_(body, rawBody, dedupeKey, eventDate, correlationId, matches, stopped, logRecord);
    notifyDeliveryFailureAdministratorSafely_(upsertResult);
    updateWebhookDiagnostic_(diagnostic, { result:'不達イベント記録', error:'' });
    return { ok: true, stopped: stopped };
  } catch (error) {
    updateWebhookDiagnostic_(diagnostic, { result:'例外終了', error:String(error && error.message || error).slice(0, 300) });
    throw error;
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
  return ({ hard_bounce:'恒久不達', soft_bounce:'一時エラー', deferred:'一時エラー', blocked:'ブロック', invalid_email:'無効アドレス', spam:'迷惑メール報告', error:'送信エラー', delivered:'配信完了' })[event] || event;
}

function findStudentsByDeliveryEmail_(email) {
  const sheet = getMasterSheet_();
  if (sheet.getLastRow() < 2) return [];
  const lastCol = Math.max(sheet.getLastColumn(), 70);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  const result = [];
  data.forEach((row, idx) => {
    const cols = EMAIL_COLS;
    cols.forEach(col => {
      if (normalizeDeliveryEmail_(row[col - 1]) !== email) return;
      result.push({ row: idx + 2, id: String(row[COL_STUDENT_ID - 1] || ''), name: String(row[COL_STUDENT_NAME - 1] || ''), school: String(row[COL_SCHOOL - 1] || ''), field: deliveryEmailFieldName_(col) });
    });
  });
  return result;
}

function deliveryEmailFieldName_(col) {
  const index = EMAIL_COLS.indexOf(col);
  if (index >= 0) return 'メール' + (index + 1);
  return '';
}

function deliveryLogValue_(record, header) {
  const index = record && record.headers ? record.headers.indexOf(header) : -1;
  return index >= 0 ? record.values[index] : '';
}

function appendDeliveryFailure_(body, rawBody, dedupeKey, eventDate, correlationId, matches, stopped, logRecord) {
  const event = normalizeBrevoEvent_(body.event);
  const sourceSystem = String(deliveryLogValue_(logRecord, '送信元システム') || 'QR_ATTENDANCE');
  const logStudentId = String(deliveryLogValue_(logRecord, '生徒番号') || '');
  const logStudentName = String(deliveryLogValue_(logRecord, '生徒氏名') || '');
  const logSchool = String(deliveryLogValue_(logRecord, '校舎') || '');
  const logMailType = String(deliveryLogValue_(logRecord, '送信種別') || deliveryLogValue_(logRecord, '種別') || '');
  const logSubject = String(deliveryLogValue_(logRecord, '件名') || body.subject || '');
  if (!matches.length && logStudentId) matches = [{id:logStudentId,name:logStudentName,school:logSchool,field:''}];
  const studentList = matches.map(m => m.id + ' ' + m.name + '（' + m.school + '）').join('\n');
  const fields = matches.map(m => m.id + ':' + m.field).join(', ');
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() >= 2) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      const sameEmail = normalizeDeliveryEmail_(rows[i][4]) === normalizeDeliveryEmail_(body.email);
      const sameEvent = String(rows[i][5]) === event;
      const sameSource = String(rows[i][29] || 'QR_ATTENDANCE') === sourceSystem;
      const sameStudent = !logStudentId || String(rows[i][13] || '').split(/\s*,\s*/).indexOf(logStudentId) >= 0;
      if (sameEmail && sameEvent && sameSource && sameStudent) {
        const row = i + 2;
        sheet.getRange(row, 3).setValue(eventDate);
        sheet.getRange(row, 7).setValue(deliveryDisplayState_(event));
        sheet.getRange(row, 8).setValue(normalizeBrevoMessageId_(body['message-id'] || body.messageId || body.message_id));
        sheet.getRange(row, 9).setValue(correlationId);
        sheet.getRange(row, 10).setValue(logSubject);
        sheet.getRange(row, 11).setValue(String(body.reason || body.error || ''));
        sheet.getRange(row, 20).setValue(stopped || rows[i][19]);
        sheet.getRange(row, 32).setValue(eventDate);
        sheet.getRange(row, 33).setValue(Math.max(1, Number(rows[i][32]) || 1) + 1);
        return { row:row, created:false, event:event, stopped:stopped || rows[i][19] };
      }
    }
  }
  sheet.appendRow([
    Utilities.getUuid(), dedupeKey, eventDate, new Date(), normalizeDeliveryEmail_(body.email), event, deliveryDisplayState_(event),
    normalizeBrevoMessageId_(body['message-id'] || body.messageId || body.message_id), correlationId, logSubject, String(body.reason || body.error || ''),
    JSON.stringify(body.tags || []), DEFAULT_FROM_EMAIL, matches.map(m => m.id).join(', '), matches.map(m => m.name).join(', '),
    matches.map(m => m.school).join(', '), fields || logMailType, studentList, studentList, stopped, '未確認', '', '', '', '', false, '', '', sourceSystem === 'STEP_MESSAGE_CENTER' ? '' : rawBody,
    sourceSystem, eventDate, eventDate, 1, '', false, '', false, '', ''
  ]);
  return { row:sheet.getLastRow(), created:true, event:event, stopped:stopped };
}

function deliveryFailureSourceLabel_(value) {
  return value === 'STEP_MESSAGE_CENTER' ? 'STEP配信' : (value === 'QR_ATTENDANCE' ? '出退くんQR' : 'その他');
}

function isMajorDeliveryFailure_(event, state, stopped) {
  const normalized = normalizeBrevoEvent_(event);
  return stopped || ['hard_bounce','invalid_email','blocked','spam'].indexOf(normalized) >= 0 || ['恒久不達','無効アドレス','ブロック','迷惑メール報告'].indexOf(String(state || '')) >= 0;
}

function notifyDeliveryFailureAdministratorSafely_(upsertResult) {
  try {
    if (!upsertResult || !upsertResult.row) return { ok:true, skipped:true };
    const sheet = getDeliveryFailureSheet_();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const row = sheet.getRange(upsertResult.row, 1, 1, headers.length).getValues()[0];
    const value = name => { const i=headers.indexOf(name); return i >= 0 ? row[i] : ''; };
    const event=String(value('イベント種別')), state=String(value('表示用状態')), stopped=value('送信停止')===true||String(value('送信停止')).toUpperCase()==='TRUE';
    const managementId=String(value('管理ID')), messageId=String(value('BrevoメッセージID'));
    if (!isMajorDeliveryFailure_(event,state,stopped)) return { ok:true, skipped:true };
    const notificationKey=[managementId,messageId,event].join('|'), notifiedValue=value('管理者通知済み');
    if(String(notifiedValue)===notificationKey||notifiedValue===true||String(notifiedValue).toUpperCase()==='TRUE')return {ok:true,duplicate:true};
    const subject='【不達メール通知】'+String(value('生徒氏名')||value('メールアドレス'))+' / '+state;
    const body=[
      '重大な不達メールが発生しました。','',
      '生徒番号：'+String(value('生徒番号')),
      '生徒氏名：'+String(value('生徒氏名')),
      '校舎：'+String(value('校舎')),
      'メールアドレス：'+String(value('メールアドレス')),
      '送信元システム：'+deliveryFailureSourceLabel_(String(value('送信元システム'))),
      '件名：'+String(value('件名')),
      'イベント種別：'+event,
      '表示用状態：'+state,
      '理由：'+String(value('理由')),
      '発生日時：'+String(value('最終発生日時')||value('発生日時')),
      '管理ID：'+managementId,
      'Brevo messageId：'+messageId
    ].join('\n');
    MailApp.sendEmail({to:DELIVERY_FAILURE_ADMIN_EMAIL,subject:subject,body:body});
    const notifiedIndex=headers.indexOf('管理者通知済み'), notifiedAtIndex=headers.indexOf('管理者通知日時');
    if(notifiedIndex>=0)sheet.getRange(upsertResult.row,notifiedIndex+1).setValue(notificationKey);
    if(notifiedAtIndex>=0)sheet.getRange(upsertResult.row,notifiedAtIndex+1).setValue(new Date());
    return {ok:true,notified:true,key:notificationKey};
  } catch(error) {
    Logger.log('不達メール管理者通知に失敗しました: '+String(error&&error.message||error));
    return {ok:false,error:String(error&&error.message||error)};
  }
}

function updateDeliveryLogFromWebhook_(record, event, eventDate, reason) {
  const state = deliveryDisplayState_(event);
  const set = (header, value) => { const idx = record.headers.indexOf(header); if (idx >= 0) record.sheet.getRange(record.row, idx + 1).setValue(value); };
  set('配信状態', state); set('最終イベント日時', eventDate); set('配信状態更新日時', new Date());
  if (event === 'delivered') set('最終配信成功日時', eventDate);
  if (event !== 'delivered') set('最終エラー理由', reason);
}

function updateDeliveredFailureRecords_(email, messageId, deliveredAt, logRecord) {
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
  const sourceSystem = String(deliveryLogValue_(logRecord, '送信元システム') || 'QR_ATTENDANCE');
  const studentId = String(deliveryLogValue_(logRecord, '生徒番号') || '');
  const belongsToDelivery = row => normalizeDeliveryEmail_(row[4]) === email && String(row[29] || 'QR_ATTENDANCE') === sourceSystem && (!studentId || String(row[13] || '').split(/\s*,\s*/).indexOf(studentId) >= 0);
  let permanentStopExists = false;
  values.forEach(row => {
    if (belongsToDelivery(row) && DELIVERY_IMMEDIATE_STOP_EVENTS.indexOf(String(row[5])) >= 0 && (row[19] === true || String(row[19]).toUpperCase() === 'TRUE')) permanentStopExists = true;
  });
  values.forEach((row, i) => {
    if (!belongsToDelivery(row)) return;
    sheet.getRange(i + 2, 28).setValue(deliveredAt);
    if (!permanentStopExists && DELIVERY_TEMP_EVENTS.indexOf(String(row[5])) >= 0) {
      sheet.getRange(i + 2, 20).setValue(false);
      sheet.getRange(i + 2, 7).setValue('配信完了');
    }
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
    if (!saved || saved !== password) throw new Error('パスワードが違います');
    if (allowedLevels.indexOf(level) < 0) throw new Error('この操作を行う権限がありません');
    return { code: code, name: String(rows[i][1] || ''), level: level };
  }
  throw new Error('スタッフ認証に失敗しました');
}

function handleDeliveryFailureAdminAction_(body) {
  const action = String(body.action || '');
  const viewLevels = ['1','2','3','4'];
  if (action === 'deliveryFailureResume') return deliveryFailureResume_(body, false);
  if (action === 'deliveryFailureSpamResume') return deliveryFailureResume_(body, true);
  if (action === 'deliveryFailureBrevoUnblock') return deliveryFailureBrevoUnblock_(body);
  const staff = verifyDeliveryStaff_(body, viewLevels);
  if (action === 'deliveryFailuresList') {
    const sheet = getDeliveryFailureSheet_();
    const values = sheet.getDataRange().getValues();
    const header = values.length ? values[0].map(String) : [];
    const allItems = values.slice(1)
      .filter(row => row.some(value => value !== '' && value !== null))
      .map(row => deliveryRowToObjectByHeaders_(row, header));
    const filteredItems = filterDeliveryFailureItems_(allItems, body || {});
    const activeItems = allItems.filter(item => !item.archived);
    return {
      ok: true,
      list: filteredItems,
      items: filteredItems,
      summary: deliveryFailureSummary_(activeItems),
      staff: {name:staff.name,level:staff.level}
    };
  }
  if (action === 'deliveryFailureSummary') return {ok:true,summary:deliveryFailureSummary_(readDeliveryFailureItems_())};
  if (action === 'deliveryFailureDetail') return { ok:true, item:getDeliveryFailureById_(body.id) };
  if (action === 'deliveryFailureRelatedStudents') return { ok:true, students:findStudentsByDeliveryEmail_(normalizeDeliveryEmail_(body.email)) };
  if (action === 'deliveryFailureConfirm') return updateDeliveryFailureAction_(body.id, {20:'確認済み',21:staff.name,22:new Date()});
  if (action === 'deliveryFailureArchive') return setDeliveryFailureArchive_(body.id, true, staff);
  if (action === 'deliveryFailureUnarchive') return setDeliveryFailureArchive_(body.id, false, staff);
  if (action === 'deliveryFailureDeletePermanent') {
    if (staff.level !== '4') throw new Error('完全削除はAK=4のみ実行できます');
    return deleteDeliveryFailurePermanent_(body.id, staff);
  }
  if (action === 'deliveryFailureStop') return setDeliveryStopForEmail_(body.id, true, staff);
  throw new Error('不明な管理操作です');
}

function normalizeDeliveryFailureHeader_(value) {
  return String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u3000/g, ' ').trim().normalize('NFKC');
}

function normalizeDeliverySourceSystem_(value) {
  const normalized = String(value || '').replace(/\u3000/g, '').trim().toUpperCase();
  if (normalized === 'STEP_MESSAGE_CENTER') return 'STEP_MESSAGE_CENTER';
  if (normalized === 'QR_ATTENDANCE') return 'QR_ATTENDANCE';
  return normalized;
}

function resolveDeliverySourceSystem_(sourceSystem, tags, rawJson) {
  const explicitSource = normalizeDeliverySourceSystem_(sourceSystem);
  if (explicitSource) return explicitSource;
  const evidence = String(tags || '') + ' ' + String(rawJson || '');
  return /step-message-center|STEP_MESSAGE_CENTER/i.test(evidence)
    ? 'STEP_MESSAGE_CENTER'
    : 'QR_ATTENDANCE';
}

function deliveryFailureBoolean_(value) {
  return value === true || ['TRUE','1','ARCHIVED','アーカイブ済み','非表示'].indexOf(String(value || '').trim().toUpperCase()) >= 0;
}

function deliveryFailureHeaderMap_(headers) {
  const map={}; headers.forEach((header,index)=>map[normalizeDeliveryFailureHeader_(header)]=index); return map;
}

function deliveryFailureValueByHeader_(row,map,names,fallback) {
  for(let i=0;i<names.length;i++){const index=map[normalizeDeliveryFailureHeader_(names[i])];if(index!==undefined)return row[index];}
  return fallback;
}

function deliveryRowToObjectByHeaders_(row,headers) {
  const map=deliveryFailureHeaderMap_(headers), value=(...names)=>deliveryFailureValueByHeader_(row,map,names,'');
  const stoppedValue=value('送信停止'), notifiedValue=value('管理者通知済み');
  const tagsValue=String(value('タグ')), rawJsonValue=String(value('元JSON'));
  const sourceSystem=resolveDeliverySourceSystem_(value('送信元システム'),tagsValue,rawJsonValue);
  const subject=String(value('件名')), fields=String(value('該当通知欄'));
  return {
    id:String(value('管理ID')),occurredAt:value('発生日時'),registeredAt:value('登録日時'),email:normalizeDeliveryEmail_(value('メールアドレス')),
    event:normalizeBrevoEvent_(value('イベント種別')),state:String(value('表示用状態')).trim(),messageId:String(value('BrevoメッセージID','Brevoメッセージ照合ID')),
    correlationId:String(value('照合ID')),subject:subject,reason:String(value('理由')),tags:tagsValue,sender:String(value('送信元')),
    studentIds:String(value('生徒番号')),studentNames:String(value('生徒氏名')),school:String(value('校舎')),fields:fields,
    students:String(value('該当生徒一覧')),relatedStudents:String(value('兄弟を含む関連生徒一覧','兄弟を含む関連')),
    stopped:stoppedValue===true||String(stoppedValue).toUpperCase()==='TRUE',confirmStatus:String(value('確認状態')),confirmer:String(value('確認者')),
    confirmedAt:value('確認日時'),resumedBy:String(value('送信再開者')),resumedAt:value('送信再開日時'),guardianConfirmed:value('本人確認済み')===true,
    guardianConfirmation:String(value('本人確認内容')),deliveredAt:value('最終配信成功日時'),rawJson:rawJsonValue,
    sourceSystem:sourceSystem,mailType:sourceSystem==='STEP_MESSAGE_CENTER'?(subject||fields||'STEP配信'):(/checkout/i.test(tagsValue)?'退室':'入室'),firstOccurredAt:value('初回発生日時'),lastOccurredAt:value('最終発生日時'),
    occurrenceCount:Number(value('発生回数'))||1,resentAt:value('再送日時'),adminNotified:!!String(notifiedValue||''),adminNotifiedAt:value('管理者通知日時'),
    archived:deliveryFailureBoolean_(value('アーカイブ状態','archived')),archivedAt:value('アーカイブ日時','archivedAt'),archivedBy:String(value('アーカイブ実行者','archivedBy'))
  };
}

function readDeliveryFailureItems_() {
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() < 2) return [];
  const values=sheet.getDataRange().getValues(), headers=values[0].map(String);
  return values.slice(1).filter(row=>row.some(value=>value!==''&&value!==null)).map(row=>deliveryRowToObjectByHeaders_(row,headers));
}

function filterDeliveryFailureItems_(items,filter) {
  return items.filter(item => {
    const emailQ = normalizeDeliveryEmail_(filter.emailSearch); const studentQ = String(filter.studentSearch || '').trim().toLowerCase();
    const sourceQ = normalizeDeliverySourceSystem_(filter.sourceSystem);
    const includeArchived = Boolean(filter.includeArchived) || Boolean(emailQ) || Boolean(studentQ);
    if (filter.archiveOnly && !item.archived) return false;
    if (!filter.archiveOnly && !includeArchived && item.archived) return false;
    if (emailQ && item.email.indexOf(emailQ) < 0) return false;
    if (studentQ && (item.studentIds + ' ' + item.studentNames).toLowerCase().indexOf(studentQ) < 0) return false;
    if (filter.school && item.school.indexOf(String(filter.school)) < 0) return false;
    if (filter.event && item.event !== normalizeBrevoEvent_(filter.event)) return false;
    if (filter.state && item.state !== filter.state) return false;
    if (filter.confirmStatus && item.confirmStatus !== String(filter.confirmStatus)) return false;
    if (sourceQ && sourceQ !== 'ALL' && item.sourceSystem !== sourceQ) return false;
    if (filter.unconfirmedOnly && item.confirmStatus === '確認済み') return false;
    if (filter.stoppedOnly && !item.stopped) return false;
    return true;
  }).reverse();
}

function deliveryFailureSummary_(items) {
  const start=new Date();start.setHours(0,0,0,0);
  let unconfirmed=0,stopped=0,today=0;
  items.forEach(item=>{
    const serious=isMajorDeliveryFailure_(item.event,item.state,item.stopped);
    if(serious&&item.confirmStatus!=='確認済み')unconfirmed++;
    if(item.stopped)stopped++;
    const occurred=item.occurredAt instanceof Date?item.occurredAt:new Date(item.occurredAt);
    if(!isNaN(occurred.getTime())&&occurred>=start)today++;
  });
  return {unconfirmed:unconfirmed,stopped:stopped,today:today,badge:unconfirmed>99?'99+':String(unconfirmed)};
}

function listDeliveryFailuresWithSummary_(filter) {
  const all=readDeliveryFailureItems_();
  return {items:filterDeliveryFailureItems_(all,filter||{}),summary:deliveryFailureSummary_(all)};
}

function listDeliveryFailures_(filter) { return listDeliveryFailuresWithSummary_(filter).items; }

/** 一時診断用。シートは読み取りのみで、結果を実行ログへ出力する。 */
function diagnoseDeliveryFailuresList() {
  const sheet = getDeliveryFailureSheet_();
  const spreadsheet = sheet.getParent();
  const values = sheet.getDataRange().getValues();
  const header = values.length ? values[0].map(String) : [];
  const allItems = values.slice(1)
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => deliveryRowToObjectByHeaders_(row, header));
  const result = {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    sheetName: sheet.getName(),
    lastRow: sheet.getLastRow(),
    header: header,
    totalRows: Math.max(values.length - 1, 0),
    beforeFilter: allItems.length,
    afterFilter: allItems.length,
    sample: allItems.slice(0, 5).map(item => ({
      source: item.sourceSystem,
      status: item.event || item.state,
      messageId: item.messageId,
      recipient: item.email
    }))
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function deliveryRowToObject_(row) {
  const sourceSystem=resolveDeliverySourceSystem_(row[29],row[11],row[28]);
  return { id:String(row[0]), occurredAt:row[2], registeredAt:row[3], email:normalizeDeliveryEmail_(row[4]), event:String(row[5]), state:String(row[6]), messageId:String(row[7]), correlationId:String(row[8]), subject:String(row[9]), reason:String(row[10]), tags:String(row[11]), sender:String(row[12]), studentIds:String(row[13]), studentNames:String(row[14]), school:String(row[15]), fields:String(row[16]), students:String(row[17]), relatedStudents:String(row[18]), stopped:row[19] === true || String(row[19]).toUpperCase()==='TRUE', confirmStatus:String(row[20]), confirmer:String(row[21]), confirmedAt:row[22], resumedBy:String(row[23]), resumedAt:row[24], guardianConfirmed:row[25] === true || String(row[25]).toUpperCase()==='TRUE', guardianConfirmation:String(row[26]), deliveredAt:row[27], rawJson:String(row[28]), sourceSystem:sourceSystem, mailType:sourceSystem==='STEP_MESSAGE_CENTER'?(String(row[9])||String(row[16])||'STEP配信'):(/checkout/i.test(String(row[11]))?'退室':'入室'), firstOccurredAt:row[30], lastOccurredAt:row[31], occurrenceCount:Number(row[32])||1, resentAt:row[33], archived:deliveryFailureBoolean_(row[36]), archivedAt:row[37], archivedBy:String(row[38]||'') };
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

function updateDeliveryFailureFieldsByHeader_(id, fields) {
  const item=getDeliveryFailureById_(id), sheet=getDeliveryFailureSheet_();
  const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(normalizeDeliveryFailureHeader_);
  Object.keys(fields).forEach(name=>{
    const index=headers.indexOf(normalizeDeliveryFailureHeader_(name));
    if(index<0)throw new Error('必要な列が見つかりません: '+name);
    sheet.getRange(item.row,index+1).setValue(fields[name]);
  });
  return {ok:true};
}

function setDeliveryFailureArchive_(id, archived, staff) {
  const updates=archived
    ? {'アーカイブ状態':true,'アーカイブ日時':new Date(),'アーカイブ実行者':staff.name}
    : {'アーカイブ状態':false,'アーカイブ日時':'','アーカイブ実行者':''};
  updateDeliveryFailureFieldsByHeader_(id,updates);
  return {ok:true,archived:archived};
}

function deleteDeliveryFailurePermanent_(id, staff) {
  const item=getDeliveryFailureById_(id);
  if(!item.archived)throw new Error('完全削除はアーカイブ済みの記録だけ実行できます');
  Logger.log(JSON.stringify({action:'deliveryFailureDeletePermanent',deletedAt:new Date(),deletedBy:staff.name,email:item.email,messageId:item.messageId,state:item.state,subject:item.subject}));
  getDeliveryFailureSheet_().deleteRow(item.row);
  return {ok:true,deleted:true};
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
  if (spamMode) {
    unblockBrevoTransactionalContact_(item.email);
  }
  setDeliveryStopForEmail_(body.id, false, staff);
  const updates = {6:'送信再開',23:staff.name,24:new Date()};
  if (spamMode) { updates[25] = true; updates[26] = String(body.confirmationDetails).trim(); updates[20] = '確認済み'; updates[21] = staff.name; updates[22] = new Date(); }
  updateDeliveryFailureAction_(body.id, updates);
  return { ok:true, stopped:false, brevoUnblockRequired:!spamMode && ['hard_bounce','blocked','invalid_email'].indexOf(item.event) >= 0 };
}

function deliveryFailureBrevoUnblock_(body) {
  const staff = verifyDeliveryStaff_(body, ['4']);
  const item = getDeliveryFailureById_(body.id);
  if (item.event === 'spam') throw new Error('spamは本人確認付きの専用解除操作を使用してください');
  unblockBrevoTransactionalContact_(item.email);
  updateDeliveryFailureAction_(body.id, {23:staff.name,24:new Date()});
  return { ok:true, brevoUnblocked:true };
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
  getDeliveryFailureSheet_(); ensureDeliveryLogColumns_(getDeliveryFailureLogSheet_());
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('BREVO_TEMP_ERROR_THRESHOLD')) props.setProperty('BREVO_TEMP_ERROR_THRESHOLD','3');
  if (!props.getProperty('BREVO_TEMP_ERROR_WINDOW_DAYS')) props.setProperty('BREVO_TEMP_ERROR_WINDOW_DAYS','7');
  if (!props.getProperty('BREVO_WEBHOOK_TOKEN')) props.setProperty('BREVO_WEBHOOK_TOKEN', Utilities.getUuid() + Utilities.getUuid().replace(/-/g,''));
  if (!props.getProperty('WEBHOOK_DIAGNOSTIC')) props.setProperty('WEBHOOK_DIAGNOSTIC','false');
  Logger.log('不達メール管理の初期設定が完了しました。Webhook URLのトークンはスクリプトプロパティで確認してください。');
}
