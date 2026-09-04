from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)

# 1) Apps Script: temporary errors become a 24h auto-pause with one retry slot.
p = Path('gas/DeliveryFailures.js')
s = p.read_text(encoding='utf-8')
old = """function isDeliveryEmailStopped_(email) {
  const normalized = normalizeDeliveryEmail_(email);
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() < 2) return false;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
  for (let i = values.length - 1; i >= 0; i--) if (normalizeDeliveryEmail_(values[i][4]) === normalized) return values[i][19] === true || String(values[i][19]).toUpperCase() === 'TRUE';
  return false;
}
"""
new = """function deliveryFailureDateOrNull_(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function getDeliveryEmailStopDecision_(email, claimRetry) {
  const normalized = normalizeDeliveryEmail_(email);
  const sheet = getDeliveryFailureSheet_();
  if (sheet.getLastRow() < 2) return { stopped:false, kind:'none', retryAt:null };
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
  const now = new Date();
  let manualStop = false;
  let permanentStop = false;
  let latestTempError = null;
  let latestRetry = null;
  const tempRows = [];

  values.forEach((row, index) => {
    if (normalizeDeliveryEmail_(row[4]) !== normalized) return;
    const stopped = row[19] === true || String(row[19]).toUpperCase() === 'TRUE';
    if (!stopped) return;
    const event = normalizeBrevoEvent_(row[5]);
    const state = String(row[6] || '');
    if (state === '手動停止') manualStop = true;
    if (DELIVERY_IMMEDIATE_STOP_EVENTS.indexOf(event) >= 0) permanentStop = true;
    if (DELIVERY_TEMP_EVENTS.indexOf(event) >= 0 && state !== '手動停止') {
      tempRows.push(index + 2);
      const errorAt = deliveryFailureDateOrNull_(row[31] || row[2]);
      const retryAt = deliveryFailureDateOrNull_(row[33]);
      if (errorAt && (!latestTempError || errorAt > latestTempError)) latestTempError = errorAt;
      if (retryAt && (!latestRetry || retryAt > latestRetry)) latestRetry = retryAt;
    }
  });

  if (manualStop) return { stopped:true, kind:'manual', retryAt:null };
  if (permanentStop) return { stopped:true, kind:'permanent', retryAt:null };
  if (!tempRows.length) return { stopped:false, kind:'none', retryAt:null };

  const props = PropertiesService.getScriptProperties();
  const retryHours = Number(props.getProperty('BREVO_TEMP_RETRY_HOURS')) || 24;
  const base = latestRetry && (!latestTempError || latestRetry > latestTempError) ? latestRetry : latestTempError;
  const retryAt = new Date((base || now).getTime() + retryHours * 3600000);
  if (now < retryAt) return { stopped:true, kind:'temporary', retryAt:retryAt };

  if (claimRetry) {
    tempRows.forEach(row => sheet.getRange(row, 34).setValue(now));
  }
  return { stopped:false, kind:'temporary-retry', retryAt:now };
}

function isDeliveryEmailStopped_(email) {
  return getDeliveryEmailStopDecision_(email, false).stopped;
}

function claimDeliveryEmailSendDecision_(email) {
  return getDeliveryEmailStopDecision_(email, true);
}
"""
s = replace_once(s, old, new, 'temporary stop decision')

old = """function setDeliveryStopForEmail_(id, stopped, staff) {
  const item = getDeliveryFailureById_(id); const sheet = getDeliveryFailureSheet_();
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
  rows.forEach((row, i) => { if (normalizeDeliveryEmail_(row[4]) === item.email) sheet.getRange(i + 2, 20).setValue(stopped); });
  return { ok:true, stopped:stopped };
}
"""
new = """function setDeliveryStopForEmail_(id, stopped, staff) {
  const item = getDeliveryFailureById_(id); const sheet = getDeliveryFailureSheet_();
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, DELIVERY_FAILURE_HEADERS.length).getValues();
  rows.forEach((row, i) => {
    if (normalizeDeliveryEmail_(row[4]) !== item.email) return;
    sheet.getRange(i + 2, 20).setValue(stopped);
    if (stopped) sheet.getRange(i + 2, 7).setValue('手動停止');
  });
  return { ok:true, stopped:stopped };
}
"""
s = replace_once(s, old, new, 'manual stop marker')
p.write_text(s, encoding='utf-8')

# 2) Check-in mail queue: re-check STOPPED recipients and claim one retry after cooldown.
p = Path('gas/コード.js')
s = p.read_text(encoding='utf-8')
old = """  recipients.forEach(recipient => {
    if (['SENT','STOPPED'].includes(recipient.status)) return;
    if (isDeliveryEmailStopped_(recipient.email)) {
      recipient.status = 'STOPPED'; recipient.error = '不達メールのため送信停止中'; return;
    }
    recipient.status = 'PROCESSING';
"""
new = """  recipients.forEach(recipient => {
    if (recipient.status === 'SENT') return;
    const stopDecision = typeof claimDeliveryEmailSendDecision_ === 'function'
      ? claimDeliveryEmailSendDecision_(recipient.email)
      : { stopped:isDeliveryEmailStopped_(recipient.email), kind:'legacy', retryAt:null };
    if (stopDecision.stopped) {
      recipient.status = 'STOPPED';
      recipient.error = stopDecision.kind === 'temporary'
        ? '一時停止（自動）' + (stopDecision.retryAt ? '：' + Utilities.formatDate(stopDecision.retryAt, Session.getScriptTimeZone(), 'M/d H:mm') + '以降に再試行' : '')
        : '不達メールのため送信停止中';
      return;
    }
    if (recipient.status === 'STOPPED') recipient.status = 'PENDING';
    recipient.error = '';
    recipient.status = 'PROCESSING';
"""
s = replace_once(s, old, new, 'queue stop gate')
p.write_text(s, encoding='utf-8')

# 3) UI: show automatic temporary pause instead of a permanent-looking stop label.
p = Path('delivery_failures.html')
s = p.read_text(encoding='utf-8')
old = """function statusHtml(x){return `<span class=\"badge\">${esc(x.state)}</span><br>${esc(x.confirmStatus)}${x.archived?'<br><span class=\"badge archiveBadge\">アーカイブ済み</span>':''}`}
"""
new = """function isTemporaryAutoPause(x){return !!x.stopped&&['soft_bounce','deferred','error'].includes(String(x.event||''))&&String(x.state||'')!=='手動停止'}
function stopLabel(x){return !x.stopped?'':(isTemporaryAutoPause(x)?'一時停止（自動）':'送信停止中')}
function stopBanner(x){const label=stopLabel(x);return label?`<div class=\"stopped\">${esc(label)}</div>`:''}
function statusHtml(x){return `<span class=\"badge\">${esc(x.state)}</span><br>${esc(x.confirmStatus)}${isTemporaryAutoPause(x)?'<br><small>24時間後に1回自動再試行</small>':''}${x.archived?'<br><span class=\"badge archiveBadge\">アーカイブ済み</span>':''}`}
"""
s = replace_once(s, old, new, 'status helpers')
s = s.replace("${esc(x.email)}${x.stopped?'<div class=\"stopped\">送信停止中</div>':''}", "${esc(x.email)}${stopBanner(x)}")
s = s.replace("${esc(x.email)}${x.stopped?'（送信停止中）':''}", "${esc(x.email)}${x.stopped?'（'+esc(stopLabel(x))+'）':''}")
p.write_text(s, encoding='utf-8')

print('temporary-error auto-retry patch applied')
