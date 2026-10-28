/** Yahoo attendance pilot. Disabled until explicitly configured; secrets stay in Script Properties. */
function postmarkPilotEligible_(email, type, acceptedAt) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('POSTMARK_PILOT_ENABLED') !== 'true') return false;
  if (type !== '入室' && type !== '退室') return false;
  const started = new Date(props.getProperty('POSTMARK_PILOT_STARTED_AT') || '');
  const accepted = acceptedAt instanceof Date ? acceptedAt : new Date(acceptedAt || '');
  if (isNaN(started.getTime()) || isNaN(accepted.getTime()) || accepted < started) return false;
  const address = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@(yahoo\.co\.jp|yahoo\.ne\.jp)$/.test(address)) return false;
  let allowlist;
  try { allowlist = JSON.parse(props.getProperty('POSTMARK_PILOT_ALLOWLIST') || '[]'); } catch (ignore) { return false; }
  return Array.isArray(allowlist) && allowlist.some(value => String(value || '').trim().toLowerCase() === address);
}

function postmarkPilotFailure_(code, correlationId) {
  return { accepted:false, provider:'POSTMARK', messageId:'', correlationId:correlationId || '', acceptedAt:new Date(), error:code, errorCode:code, httpStatus:0, retrySafe:false };
}

function postmarkPilotLedgerKey_(correlationId) {
  return 'POSTMARK_PILOT_SEND_' + shortCheckInHash_(String(correlationId));
}

/** No automatic reset: the pilot has a lifetime attempt budget, including rejected/uncertain sends. */
function reservePostmarkPilotAttempt_(correlationId, email) {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  const alreadyLocked = lock.hasLock();
  if (!alreadyLocked && !lock.tryLock(10000)) return { error:'POSTMARK_LEDGER_BUSY' };
  try {
    const key = postmarkPilotLedgerKey_(correlationId);
    const saved = props.getProperty(key);
    if (saved) {
      let record;
      try { record = JSON.parse(saved); } catch (ignore) { return { error:'POSTMARK_LEDGER_INVALID' }; }
      if (record.email !== email) return { error:'POSTMARK_CORRELATION_CONFLICT' };
      if (record.status === 'ACCEPTED') return { replay:record };
      return { error:'POSTMARK_DELIVERY_UNCERTAIN' };
    }
    const rawLimit = props.getProperty('POSTMARK_PILOT_MAX_ATTEMPTS') || '20';
    const limit = Number(rawLimit);
    const used = Number(props.getProperty('POSTMARK_PILOT_ATTEMPTS_USED') || '0');
    if (!Number.isInteger(limit) || limit < 1 || limit > 90 || !Number.isInteger(used) || used < 0) return { error:'POSTMARK_BUDGET_INVALID' };
    if (used >= limit) return { error:'POSTMARK_PILOT_BUDGET_EXHAUSTED' };
    // Charge before reserving. A crash can consume budget, but must never create another send.
    props.setProperty('POSTMARK_PILOT_ATTEMPTS_USED', String(used + 1));
    props.setProperty(key, JSON.stringify({ status:'RESERVED', email:email, at:new Date().toISOString() }));
    return { key:key };
  } finally { if (!alreadyLocked) lock.releaseLock(); }
}

function sendEmailViaPostmarkPilot_(toEmail, subject, htmlBody, options) {
  options = options || {};
  const props = PropertiesService.getScriptProperties();
  const correlationId = String(options.correlationId || '');
  const email = String(toEmail || '').trim().toLowerCase();
  if (!correlationId) return postmarkPilotFailure_('POSTMARK_CORRELATION_REQUIRED', correlationId);
  if (String(props.getProperty('CHECKIN_MAIL_DIAGNOSTIC_MODE') || '').toUpperCase() === 'TRUE') return { accepted:true, provider:'DIAGNOSTIC', messageId:'diagnostic-' + Utilities.getUuid(), correlationId:correlationId, acceptedAt:new Date(), error:'', httpStatus:204 };
  const token = String(props.getProperty('POSTMARK_SERVER_TOKEN') || '').trim();
  const webhookToken = String(props.getProperty('POSTMARK_WEBHOOK_TOKEN') || '').trim();
  if (!token || webhookToken.length < 32 || props.getProperty('POSTMARK_PILOT_WEBHOOK_READY') !== 'true') return postmarkPilotFailure_('POSTMARK_CONFIG_INCOMPLETE', correlationId);
  const from = String(options.fromEmail || getCheckInFromEmail_()).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) return postmarkPilotFailure_('POSTMARK_SENDER_INVALID', correlationId);
  const reservation = reservePostmarkPilotAttempt_(correlationId, email);
  if (reservation.error) return postmarkPilotFailure_(reservation.error, correlationId);
  if (reservation.replay) return { accepted:true, provider:'POSTMARK', messageId:reservation.replay.messageId, correlationId:correlationId, acceptedAt:new Date(reservation.replay.at), error:'', httpStatus:200, replayed:true };
  const payload = {
    From:from, To:email, Subject:subject, HtmlBody:htmlBody,
    TextBody:String(htmlBody || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ''),
    MessageStream:'outbound', Tag:'student-qr-yahoo-pilot',
    Metadata:{ correlation_id:correlationId, source_system:'QR_ATTENDANCE' },
    TrackOpens:false, TrackLinks:'None'
  };
  if (options.attachmentBase64 && options.attachmentName) payload.Attachments = [{ Name:options.attachmentName, Content:options.attachmentBase64, ContentType:'image/jpeg' }];
  let response;
  try {
    response = UrlFetchApp.fetch('https://api.postmarkapp.com/email', { method:'post', contentType:'application/json', headers:{ 'X-Postmark-Server-Token':token, Accept:'application/json' }, payload:JSON.stringify(payload), muteHttpExceptions:true });
  } catch (ignore) {
    // Keep RESERVED. Timeout may mean the provider accepted it: never retry or fall back blindly.
    return postmarkPilotFailure_('POSTMARK_DELIVERY_UNCERTAIN', correlationId);
  }
  let body = {};
  try { body = JSON.parse(response.getContentText() || '{}'); } catch (ignore) {}
  if (response.getResponseCode() === 200 && body.ErrorCode === 0 && /^[a-f0-9-]{36}$/i.test(String(body.MessageID || ''))) {
    const messageId = 'postmark:' + String(body.MessageID).toLowerCase();
    props.setProperty(reservation.key, JSON.stringify({ status:'ACCEPTED', email:email, messageId:messageId, at:new Date().toISOString() }));
    return { accepted:true, provider:'POSTMARK', messageId:messageId, correlationId:correlationId, acceptedAt:new Date(), error:'', httpStatus:200 };
  }
  // Keep the reservation even on explicit rejection; operator review is required before another attempt.
  return postmarkPilotFailure_('POSTMARK_SEND_REJECTED', correlationId);
}

function isPostmarkWebhookCandidate_(e, body) {
  return Boolean(e && e.parameter && Object.prototype.hasOwnProperty.call(e.parameter, 'postmarkWebhookToken')) || Boolean(body && ['Delivery','Bounce','SpamComplaint'].indexOf(body.RecordType) >= 0);
}

function handlePostmarkWebhookRequest_(e, body) {
  const props = PropertiesService.getScriptProperties();
  const expected = String(props.getProperty('POSTMARK_WEBHOOK_TOKEN') || '');
  const actual = String(e && e.parameter && e.parameter.postmarkWebhookToken || '');
  if (expected.length < 32 || !constantTimeEquals_(expected, actual)) return { ok:false, code:'POSTMARK_WEBHOOK_UNAUTHORIZED' };
  if (!body || body.MessageStream !== 'outbound' || String(body.ServerID || body.ServerId || '') !== String(props.getProperty('POSTMARK_SERVER_ID') || '')) return { ok:false, code:'POSTMARK_WEBHOOK_SCOPE_INVALID' };
  const email = String(body.Recipient || body.Email || '').trim().toLowerCase();
  const rawId = String(body.MessageID || '').toLowerCase();
  if (!/^[a-f0-9-]{36}$/.test(rawId)) return { ok:false, code:'POSTMARK_WEBHOOK_MESSAGE_INVALID' };
  const messageId = 'postmark:' + rawId;
  const event = body.RecordType === 'Delivery' ? 'delivered' : body.RecordType === 'SpamComplaint' ? 'spam' : body.RecordType === 'Bounce' ? (body.Type === 'HardBounce' ? 'hard_bounce' : body.Type === 'SpamComplaint' ? 'spam' : body.Inactive === true ? 'blocked' : 'soft_bounce') : '';
  const eventDate = new Date(body.DeliveredAt || body.BouncedAt || body.ReceivedAt || '');
  if (!email || !event || isNaN(eventDate.getTime())) return { ok:false, code:'POSTMARK_WEBHOOK_EVENT_INVALID' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  const record = findDeliveryLogRecord_(messageId, '');
  if (!record) return { ok:true, matched:false };
  const receiptId = String(deliveryLogValue_(record, '受付ID') || '');
  const queue = getCheckInMailQueueSheet_();
  if (!receiptId || queue.getLastRow() < 2) return { ok:false, code:'POSTMARK_QUEUE_NOT_FOUND' };
  const match = queue.getRange(2, 1, queue.getLastRow() - 1, 1).createTextFinder(receiptId).matchEntireCell(true).findNext();
  if (!match) return { ok:false, code:'POSTMARK_QUEUE_NOT_FOUND' };
  let recipients;
  try { recipients = JSON.parse(String(queue.getRange(match.getRow(), 11).getValue() || '[]')); } catch (ignore) { return { ok:false, code:'POSTMARK_QUEUE_INVALID' }; }
  const recipient = recipients.find(r => r.provider === 'POSTMARK' && r.messageId === messageId && String(r.email || '').trim().toLowerCase() === email);
  if (!recipient) return { ok:false, code:'POSTMARK_RECIPIENT_MISMATCH' };
    const key = deliveryHash_([messageId, email, event, eventDate.toISOString(), String(body.ID || '')].join('|'));
    if (deliveryDedupeExists_(key)) return { ok:true, duplicate:true };
    const reason = event === 'delivered' ? '' : String(body.Description || body.Details || body.Type || '').slice(0, 500);
    if (!shouldApplyDeliveryEvent_(recipient.deliveryEvent, recipient.deliveryEventAt, event, eventDate)) return { ok:true, ignored:true };
    updateDeliveryLogFromWebhook_(record, event, eventDate, reason, email, messageId);
    if (event === 'delivered') { updateDeliveredFailureRecords_(email, messageId, eventDate, record); return { ok:true, delivered:true }; }
    const normalized = { event:event, email:email, 'message-id':messageId, reason:reason, tags:['postmark-yahoo-pilot'] };
    const stopped = ['hard_bounce','blocked','spam'].indexOf(event) >= 0 || shouldStopForTemporaryErrors_(email, messageId, event, eventDate);
    const result = appendDeliveryFailure_(normalized, JSON.stringify(normalized), key, eventDate, String(recipient.correlationId || ''), findStudentsByDeliveryEmail_(email), stopped, record);
    notifyDeliveryFailureAdministratorSafely_(result);
    notifyDeliveryFailureLineSafely_(result);
    return { ok:true, stopped:stopped };
  } finally { lock.releaseLock(); }
}

/** A terminal delivery must not be regressed by a delayed temporary/acceptance event. */
function shouldApplyDeliveryEvent_(previousEvent, previousAt, event, eventDate) {
  if (previousEvent === 'delivered' && ['accepted','deferred','soft_bounce','error'].indexOf(event) >= 0) return false;
  const previous = new Date(previousAt || '');
  return isNaN(previous.getTime()) || !(eventDate instanceof Date) || eventDate >= previous;
}

/** Local execution only. Returns readiness flags and counts, never credentials or addresses. */
function postmarkPilotHealth() {
  const props = PropertiesService.getScriptProperties();
  let list = [];
  try { list = JSON.parse(props.getProperty('POSTMARK_PILOT_ALLOWLIST') || '[]'); } catch (ignore) {}
  return { enabled:props.getProperty('POSTMARK_PILOT_ENABLED') === 'true', tokenPresent:!!props.getProperty('POSTMARK_SERVER_TOKEN'), webhookTokenPresent:String(props.getProperty('POSTMARK_WEBHOOK_TOKEN') || '').length >= 32, webhookReady:props.getProperty('POSTMARK_PILOT_WEBHOOK_READY') === 'true', serverIdPresent:!!props.getProperty('POSTMARK_SERVER_ID'), startedAtPresent:!isNaN(new Date(props.getProperty('POSTMARK_PILOT_STARTED_AT') || '').getTime()), allowlistCount:Array.isArray(list) ? list.length : 0, attemptsUsed:Number(props.getProperty('POSTMARK_PILOT_ATTEMPTS_USED') || '0'), maxAttempts:Number(props.getProperty('POSTMARK_PILOT_MAX_ATTEMPTS') || '20') };
}

/** Read-only provider reconciliation for accepted pilot messages. Never sends or retries email. */
function reconcilePostmarkPilotDeliveries() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('POSTMARK_SERVER_TOKEN') || '');
  if (!token) return { ok:false, code:'POSTMARK_CONFIG_INCOMPLETE' };
  const queue = getCheckInMailQueueSheet_();
  if (queue.getLastRow() < 2) return { ok:true, checked:0, delivered:0 };
  const rows = queue.getRange(2, 1, queue.getLastRow() - 1, CHECKIN_MAIL_QUEUE_HEADERS.length).getValues();
  let checked = 0, delivered = 0, failed = 0;
  for (let i = rows.length - 1; i >= 0 && checked < 20; i--) {
    let recipients;
    try { recipients = JSON.parse(String(rows[i][10] || '[]')); } catch (ignore) { continue; }
    for (let j = 0; j < recipients.length && checked < 20; j++) {
      const recipient = recipients[j];
      if (recipient.provider !== 'POSTMARK' || recipient.deliveryEvent === 'delivered' || !/^postmark:[a-f0-9-]{36}$/.test(String(recipient.messageId || ''))) continue;
      checked++;
      try {
        const response = UrlFetchApp.fetch('https://api.postmarkapp.com/messages/outbound/' + recipient.messageId.slice(9) + '/details', { method:'get', headers:{ 'X-Postmark-Server-Token':token, Accept:'application/json' }, muteHttpExceptions:true });
        if (response.getResponseCode() !== 200) { failed++; continue; }
        const body = JSON.parse(response.getContentText());
        if (body.MessageID !== recipient.messageId.slice(9) || body.MessageStream !== 'outbound' || body.Sandboxed !== false) { failed++; continue; }
        const events = Array.isArray(body.MessageEvents) ? body.MessageEvents : [];
        const email = String(recipient.email || '').toLowerCase();
        const event = events.filter(item => item.Type === 'Delivered' && String(item.Recipient || '').toLowerCase() === email && !isNaN(new Date(item.ReceivedAt).getTime())).sort((a,b) => new Date(b.ReceivedAt) - new Date(a.ReceivedAt))[0];
        if (!event) continue;
        const lock = LockService.getScriptLock();
        lock.waitLock(30000);
        try {
          const record = findDeliveryLogRecord_(recipient.messageId, '');
          if (record) { const applied = updateDeliveryLogFromWebhook_(record, 'delivered', new Date(event.ReceivedAt), '', email, recipient.messageId); if (!applied || !applied.ignored) { updateDeliveredFailureRecords_(email, recipient.messageId, new Date(event.ReceivedAt), record); delivered++; } }
        } finally { lock.releaseLock(); }
      } catch (ignore) { failed++; }
    }
  }
  return { ok:true, checked:checked, delivered:delivered, failed:failed };
}

/** GET /server only. Never log/return the response: it includes ApiTokens. */
function verifyPostmarkPilotServer() {
  const props = PropertiesService.getScriptProperties();
  const health = postmarkPilotHealth();
  const token = String(props.getProperty('POSTMARK_SERVER_TOKEN') || '');
  if (!token) return { ok:false, code:'POSTMARK_CONFIG_INCOMPLETE', health:health };
  try {
    const response = UrlFetchApp.fetch('https://api.postmarkapp.com/server', { method:'get', headers:{ 'X-Postmark-Server-Token':token, Accept:'application/json' }, muteHttpExceptions:true });
    if (response.getResponseCode() !== 200) return { ok:false, code:'POSTMARK_SERVER_CHECK_FAILED', health:health };
    const server = JSON.parse(response.getContentText());
    const serverMatches = String(server.ID || '') === String(props.getProperty('POSTMARK_SERVER_ID') || '');
    return { ok:serverMatches && server.DeliveryType === 'Live', serverMatches:serverMatches, live:server.DeliveryType === 'Live', health:health };
  } catch (ignore) { return { ok:false, code:'POSTMARK_SERVER_CHECK_FAILED', health:health }; }
}

/** Install only after staging verification. This trigger only reads provider delivery events. */
function setupPostmarkPilotReconciliation() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('POSTMARK_PILOT_WEBHOOK_READY') !== 'true') throw new Error('POSTMARK_WEBHOOK_NOT_READY');
  const existing = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'reconcilePostmarkPilotDeliveries');
  if (!existing) ScriptApp.newTrigger('reconcilePostmarkPilotDeliveries').timeBased().everyMinutes(5).create();
  return { ok:true, created:!existing };
}
