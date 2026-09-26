from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
gas_path = ROOT / "gas" / "DeliveryFailures.js"
html_path = ROOT / "delivery_failures.html"

gas = gas_path.read_text(encoding="utf-8")
html = html_path.read_text(encoding="utf-8")

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"patch anchor not found: {label}")
    return text.replace(old, new, 1)

# GAS headers/actions/constants
gas = replace_once(gas,
    "  'アーカイヘ状態','アーカイヘ日時','アーカイヘ実行者'\n];",
    "  'アーカイブ状態','アーカイブ日時','アーカイブ実行者','LINE通知済み','LINE通知日時','LINE通知結果'\n];",
    "failure headers")
gas = replace_once(gas,
    "'deliveryFailureReportSettingsGet','deliveryFailureReportSettingsSave'];",
    "'deliveryFailureReportSettingsGet','deliveryFailureReportSettingsSave','deliveryFailureLineSettingsGet','deliveryFailureLineSettingsSave','deliveryFailureLineTest'];",
    "admin actions")
gas = replace_once(gas,
    "const DELIVERY_FAILURE_MANAGER_URL = 'https://stepkobetsu-hub.github.io/student-QR/delivery_failures.html';",
    """const DELIVERY_FAILURE_MANAGER_URL = 'https://stepkobetsu-hub.github.io/student-QR/delivery_failures.html';
const DELIVERY_FAILURE_LINE_API_URL = 'https://jbiolkvegexkqjcwtyye.supabase.co/functions/v1/line-teacher-api';
const DELIVERY_FAILURE_LINE_SESSION_PROPERTY = 'DELIVERY_FAILURE_LINE_SESSION_TOKEN';
const DELIVERY_FAILURE_LINE_CODES_PROPERTY = 'DELIVERY_FAILURE_LINE_TEACHER_CODES';
const DELIVERY_FAILURE_LINE_DEFAULT_CODES = ['7001'];""",
    "line constants")

gas = replace_once(gas,
    "    notifyDeliveryFailureAdministratorSafely_(upsertResult);\n    updateWebhookDiagnostic_(diagnostic, { result:'不達イベント記録', error:'' });",
    "    notifyDeliveryFailureAdministratorSafely_(upsertResult);\n    notifyDeliveryFailureLineSafely_(upsertResult);\n    updateWebhookDiagnostic_(diagnostic, { result:'不達イベント記録', error:'' });",
    "webhook notification")

anchor = "function notifyDeliveryFailureAdministratorSafely_(upsertResult) {\n"
line_helpers = r'''
function normalizeDeliveryFailureLineCodes_(input) {
  let values = input;
  if (!Array.isArray(values)) {
    const text = String(values || '').trim();
    if (!text) values = DELIVERY_FAILURE_LINE_DEFAULT_CODES.slice();
    else {
      try {
        const parsed = JSON.parse(text);
        values = Array.isArray(parsed) ? parsed : text.split(/[\s,;]+/);
      } catch (ignore) {
        values = text.split(/[\s,;]+/);
      }
    }
  }
  const result = [];
  values.forEach(function(value) {
    const code = String(value || '').trim();
    if (/^7\d{3}$/.test(code) && result.indexOf(code) < 0) result.push(code);
  });
  return result.length ? result : DELIVERY_FAILURE_LINE_DEFAULT_CODES.slice();
}

function getDeliveryFailureLineSettings_() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty(DELIVERY_FAILURE_LINE_SESSION_PROPERTY) || '').trim();
  const codes = normalizeDeliveryFailureLineCodes_(props.getProperty(DELIVERY_FAILURE_LINE_CODES_PROPERTY) || '');
  return { configured:!!token, teacherCodes:codes };
}

function callDeliveryFailureLineApi_(payload) {
  const response = UrlFetchApp.fetch(DELIVERY_FAILURE_LINE_API_URL, {
    method:'post',
    contentType:'application/json',
    payload:JSON.stringify(payload || {}),
    muteHttpExceptions:true
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  let data = {};
  try { data = JSON.parse(text || '{}'); } catch (ignore) {}
  if (status < 200 || status >= 300 || data.ok === false) {
    const error = new Error(String(data.error || data.message || ('LINE通知APIでエラーが発生しました (' + status + ')')));
    error.status = status;
    throw error;
  }
  return data;
}

function saveDeliveryFailureLineSettings_(sessionToken, teacherCodes, staff) {
  const token = String(sessionToken || '').trim();
  if (!token) throw new Error('LINE通知用セッションがありません');
  const codes = normalizeDeliveryFailureLineCodes_(teacherCodes);
  callDeliveryFailureLineApi_({action:'health',systemPortalSessionToken:token});
  const props = PropertiesService.getScriptProperties();
  props.setProperty(DELIVERY_FAILURE_LINE_SESSION_PROPERTY, token);
  props.setProperty(DELIVERY_FAILURE_LINE_CODES_PROPERTY, JSON.stringify(codes));
  Logger.log(JSON.stringify({action:'deliveryFailureLineSettingsSave',savedAt:new Date(),savedBy:staff.name,teacherCodes:codes}));
  return {ok:true,configured:true,teacherCodes:codes,savedBy:staff.name};
}

function deliveryFailureLineMessage_(value) {
  const event = normalizeBrevoEvent_(value('イベント種別'));
  const state = String(value('表示用状態') || '');
  const source = deliveryFailureSourceLabel_(String(value('送信元システム')));
  const mailType = String(value('該当通知欄') || value('件名') || 'メール');
  const isTemporary = ['soft_bounce','deferred','error'].indexOf(event) >= 0;
  const headline = isTemporary ? '⚠️ 入退室メールで一時エラーが発生しました' : '🚨 入退室メールが未達になりました';
  return [
    headline,'',
    '生徒：' + String(value('生徒氏名') || '-'),
    '生徒番号：' + String(value('生徒番号') || '-'),
    '校舎：' + String(value('校舎') || '-'),
    'メール区分：' + mailType,
    '送信元：' + source,
    '宛先：' + String(value('メールアドレス') || '-'),
    '状態：' + state + ' (' + event + ')',
    '理由：' + String(value('理由') || '-'),
    '発生：' + String(value('最終発生日時') || value('発生日時') || ''),
    '',
    isTemporary ? '現時点では配信完了を確認できていません。' : '保護者への配信完了を確認できていません。',
    '不達メール管理： ' + DELIVERY_FAILURE_MANAGER_URL
  ].join('\n');
}

function notifyDeliveryFailureLineSafely_(upsertResult) {
  let sheet, headers, row, value, resultIndex;
  try {
    if (!upsertResult || !upsertResult.row) return {ok:true,skipped:true};
    const settings = getDeliveryFailureLineSettings_();
    if (!settings.configured) return {ok:true,skipped:true,reason:'line_not_configured'};
    sheet = getDeliveryFailureSheet_();
    headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
    row = sheet.getRange(upsertResult.row,1,1,headers.length).getValues()[0];
    value = name => { const i=headers.indexOf(name); return i >= 0 ? row[i] : ''; };
    const managementId = String(value('管理ID'));
    const messageId = String(value('BrevoメッセージID'));
    const event = String(value('イベント種別'));
    const notificationKey = [managementId,messageId,event].join('|');
    const sentIndex = headers.indexOf('LINE通知済み');
    const sentAtIndex = headers.indexOf('LINE通知日時');
    resultIndex = headers.indexOf('LINE通知結果');
    if (sentIndex >= 0 && String(row[sentIndex] || '') === notificationKey) return {ok:true,duplicate:true};
    const data = callDeliveryFailureLineApi_({
      action:'send',
      systemPortalSessionToken:String(PropertiesService.getScriptProperties().getProperty(DELIVERY_FAILURE_LINE_SESSION_PROPERTY) || ''),
      teacherCodes:settings.teacherCodes,
      message:deliveryFailureLineMessage_(value),
      imageDataUrl:'',imageName:'',includeCallRequest:false
    });
    if (sentIndex >= 0) sheet.getRange(upsertResult.row,sentIndex+1).setValue(notificationKey);
    if (sentAtIndex >= 0) sheet.getRange(upsertResult.row,sentAtIndex+1).setValue(new Date());
    if (resultIndex >= 0) sheet.getRange(upsertResult.row,resultIndex+1).setValue('成功 ' + Number(data.sentCount || 0) + '件');
    return {ok:true,notified:true,sentCount:Number(data.sentCount || 0),teacherCodes:settings.teacherCodes};
  } catch (error) {
    try {
      if (sheet && resultIndex >= 0 && upsertResult && upsertResult.row) sheet.getRange(upsertResult.row,resultIndex+1).setValue('失趗: ' + String(error && error.message || error).slice(0,300));
    } catch (ignore) {}
    Logger.log('不達メールLINE通知に失赗しました: ' + String(error && error.message || error));
    return {okjfalse,error:String(error && error.message || error)};
  }
}

function testDeliveryFailureLine_(staff) {
  const settings = getDeliveryFailureLineSettings_();
  if (!settings.configured) throw new Error('LINE通知設定がまだありません');
  const data = callDeliveryFailureLineApi_({
    action:'send',
    systemPortalSessionToken:String(PropertiesService.getScriptProperties().getProperty(DELIVERY_FAILURE_LINE_SESSION_PROPERTY) || ''),
    teacherCodes:settings.teacherCodes,
    message:'✅ 不達メールLINE通知のテストです。\n設定者：' + staff.name + '\n滶後：入退室メール等で不達�一時エラーが発生するとこのLINEへ通知します。',
    imageDataUrl:'',imageName:'',includeCallRequest:false
  });
  return {ok:true,sentCount:Number(data.sentCount || 0),teacherCodes:settings.teacherCodes};
}
