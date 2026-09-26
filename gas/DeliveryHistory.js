/** 不達メールの送信状況履歴 */

function deliveryHistoryDate_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && isFinite(value)) {
    const numeric = value > 100000000000 ? value : value * 1000;
    const fromNumber = new Date(numeric);
    return isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  const parsed = new Date(String(value || ''));
  return isNaN(parsed.getTime()) ? null : parsed;
}

function deliveryHistoryDayKey_(value) {
  const date = deliveryHistoryDate_(value);
  return date ? Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd') : '';
}

function deliveryHistoryHeaderIndex_(headers, names) {
  const normalized = headers.map(normalizeDeliveryFailureHeader_);
  for (let i = 0; i < names.length; i++) {
    const index = normalized.indexOf(normalizeDeliveryFailureHeader_(names[i]));
    if (index >= 0) return index;
  }
  return -1;
}

function deliveryHistoryCell_(row, headers, names) {
  const index = deliveryHistoryHeaderIndex_(headers, names);
  return index >= 0 ? row[index] : '';
}

function deliveryHistoryRowHasEmail_(row, email) {
  const target = normalizeDeliveryEmail_(email);
  if (!target) return false;
  return row.some(function(value) {
    return String(value == null ? '' : value).toLowerCase().indexOf(target) >= 0;
  });
}

function readDeliveryQueueRecipientsByReceipt_() {
  const result = {};
  const sheets = typeof getDeliveryHistorySourceSheets_ === 'function'
    ? getDeliveryHistorySourceSheets_('メール送信キュー')
    : [getDeliveryFailureSpreadsheet_().getSheetByName('メール送信キュー')];
  sheets.forEach(function(sheet) {
    if (!sheet || sheet.getLastRow() < 2) return;
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    values.slice(1).forEach(function(row) {
      const receiptId = String(deliveryHistoryCell_(row, headers, ['受付ID']) || '').trim();
      if (!receiptId || result[receiptId]) return;
      const rawRecipients = deliveryHistoryCell_(row, headers, ['送信先JSON']);
      let recipients = [];
      try {
        const parsed = JSON.parse(String(rawRecipients || '[]'));
        if (Array.isArray(parsed)) {
          recipients = parsed.map(function(recipient) {
            return normalizeDeliveryEmail_(recipient && recipient.email);
          }).filter(Boolean);
        }
      } catch (ignore) {}
      result[receiptId] = recipients;
    });
  });
  return result;
}

function readNormalDeliveryHistoryForEmail_(email) {
  return readNormalDeliveryHistoryForEmails_([email])[normalizeDeliveryEmail_(email)] || [];
}

function readNormalDeliveryHistoryForEmails_(emails) {
  const targets = {};
  (emails || []).forEach(function(email) {
    const normalized = normalizeDeliveryEmail_(email);
    if (normalized) targets[normalized] = [];
  });
  const targetEmails = Object.keys(targets);
  if (!targetEmails.length) return targets;
  const queueRecipientsByReceipt = readDeliveryQueueRecipientsByReceipt_();
  const sheets = typeof getDeliveryHistorySourceSheets_ === 'function'
    ? getDeliveryHistorySourceSheets_('ログ')
    : [getDeliveryFailureLogSheet_()];
  sheets.forEach(function(sheet) {
    if (!sheet || sheet.getLastRow() < 2) return;
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    values.slice(1).forEach(function(row, index) {
      const receiptId = String(deliveryHistoryCell_(row, headers, ['受付ID']) || '').trim();
      const queueRecipients = queueRecipientsByReceipt[receiptId] || [];
      const rowText = row.map(function(value) { return String(value == null ? '' : value).toLowerCase(); }).join('\n');
      const matchedEmails = targetEmails.filter(function(email) {
        return rowText.indexOf(email) >= 0 || queueRecipients.indexOf(email) >= 0;
      });
      if (!matchedEmails.length) return;
      const occurredAt = deliveryHistoryCell_(row, headers, ['受付日時','タイムスタンプ','登録日時','送信完了日時','更新日時']);
      const occurredDate = deliveryHistoryDate_(occurredAt);
      if (!occurredDate) return;
      const deliveredAt = deliveryHistoryCell_(row, headers, ['最終配信成功日時','送信完了日時']);
      const status = String(deliveryHistoryCell_(row, headers, ['配信状態','状態','メール送信結果']) || '').trim();
      const mailType = String(deliveryHistoryCell_(row, headers, ['送信種別','種別']) || '').trim();
      const entry = {
        kind:'send',
        row:index + 2,
        occurredAt:occurredDate,
        finalAt:deliveryHistoryCell_(row, headers, ['最終イベント日時','配信状態更新日時','更新日時']) || deliveredAt || occurredDate,
        status:status || (deliveredAt ? '配信完了' : '送信記録'),
        delivered:Boolean(deliveredAt) || /配信完了|delivered/i.test(status),
        reason:String(deliveryHistoryCell_(row, headers, ['最終エラー理由','理由']) || ''),
        subject:String(deliveryHistoryCell_(row, headers, ['件名']) || ''),
        studentName:String(deliveryHistoryCell_(row, headers, ['生徒氏名']) || ''),
        studentId:String(deliveryHistoryCell_(row, headers, ['生徒番号']) || ''),
        mailType:mailType || '送信',
        sourceSystem:String(deliveryHistoryCell_(row, headers, ['送信元システム']) || '')
      };
      matchedEmails.forEach(function(email) { targets[email].push(entry); });
    });
  });
  return targets;
}

function deliveryRecoveryTokens_(value) {
  return String(value || '').split(/[\s,、\n]+/).map(function(token) { return token.trim(); }).filter(Boolean);
}

function deliveryRecoveryHasIntersection_(left, right) {
  const rightTokens = deliveryRecoveryTokens_(right);
  return deliveryRecoveryTokens_(left).some(function(token) { return rightTokens.indexOf(token) >= 0; });
}

function deliveryRecoverySource_(value) {
  const source = String(value || '').replace(/\u3000/g, '').trim().toUpperCase();
  return source || 'QR_ATTENDANCE';
}

function deliveryRecoveryEntryMatchesFailure_(entry, item) {
  if (!entry || !item) return false;
  if (normalizeDeliveryEmail_(entry.email || item.email) !== normalizeDeliveryEmail_(item.email)) return false;
  const itemSource = deliveryRecoverySource_(item.sourceSystem);
  const entrySource = deliveryRecoverySource_(entry.sourceSystem);
  if (itemSource !== entrySource) return false;
  const itemIds = deliveryRecoveryTokens_(item.studentIds);
  const entryIds = deliveryRecoveryTokens_(entry.studentId);
  if (itemIds.length) return entryIds.length > 0 && deliveryRecoveryHasIntersection_(item.studentIds, entry.studentId);
  const itemNames = deliveryRecoveryTokens_(item.studentNames);
  const entryNames = deliveryRecoveryTokens_(entry.studentName);
  if (itemNames.length) return entryNames.length > 0 && deliveryRecoveryHasIntersection_(item.studentNames, entry.studentName);
  return true;
}

function annotateDeliveryFailureRecovery_(items) {
  const temporary = items.filter(function(item) {
    return DELIVERY_TEMP_EVENTS.indexOf(normalizeBrevoEvent_(item.event)) >= 0;
  });
  const emails = temporary.map(function(item) { return normalizeDeliveryEmail_(item.email); }).filter(Boolean);
  const rawHistoryByEmail = readNormalDeliveryHistoryForEmails_(emails);
  const historyByEmail = {};
  Object.keys(rawHistoryByEmail).forEach(function(email) {
    historyByEmail[email] = rawHistoryByEmail[email].filter(function(entry) {
      return entry.delivered || /配信完了|delivered|送信完了|送信成功|成功/i.test(String(entry.status || ''));
    }).map(function(entry) { return Object.assign({email:email}, entry); });
  });
  return items.map(function(item) {
    const event = normalizeBrevoEvent_(item.event);
    if (DELIVERY_TEMP_EVENTS.indexOf(event) < 0) return Object.assign({}, item, {recovered:false,recoveredAt:''});
    const errorAt = deliveryHistoryDate_(item.lastOccurredAt || item.occurredAt);
    const match = (historyByEmail[normalizeDeliveryEmail_(item.email)] || []).filter(function(entry) {
      const deliveredAt = deliveryHistoryDate_(entry.finalAt) || deliveryHistoryDate_(entry.occurredAt);
      return errorAt && deliveredAt && deliveredAt.getTime() > errorAt.getTime() && deliveryRecoveryEntryMatchesFailure_(entry, item);
    }).sort(function(a, b) {
      const aDate = deliveryHistoryDate_(a.finalAt) || deliveryHistoryDate_(a.occurredAt);
      const bDate = deliveryHistoryDate_(b.finalAt) || deliveryHistoryDate_(b.occurredAt);
      return aDate.getTime() - bDate.getTime();
    })[0];
    return Object.assign({}, item, {recovered:Boolean(match),recoveredAt:match ? (match.finalAt || match.occurredAt) : ''});
  });
}

function deliveryFailureToHistoryItem_(item) {
  return {
    kind:'error',
    relation:'error',
    id:item.id,
    occurredAt:item.lastOccurredAt || item.occurredAt,
    firstOccurredAt:item.firstOccurredAt || item.occurredAt,
    lastOccurredAt:item.lastOccurredAt || item.occurredAt,
    occurrenceCount:Number(item.occurrenceCount) || 1,
    finalAt:item.lastOccurredAt || item.occurredAt,
    status:item.state || item.event || 'エラー',
    event:item.event,
    reason:item.reason,
    subject:item.subject,
    studentName:item.studentNames,
    studentId:item.studentIds,
    mailType:item.mailType,
    sourceSystem:item.sourceSystem,
    archived:Boolean(item.archived)
  };
}

function getDeliveryAddressHistory_(item) {
  if (!item || !item.email) throw new Error('送信履歴の対象メールアドレスがありません');
  const email = normalizeDeliveryEmail_(item.email);
  const normal = readNormalDeliveryHistoryForEmail_(email).sort(function(a, b) {
    const aDate = deliveryHistoryDate_(a.finalAt) || deliveryHistoryDate_(a.occurredAt);
    const bDate = deliveryHistoryDate_(b.finalAt) || deliveryHistoryDate_(b.occurredAt);
    return (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0);
  });
  const errors = readDeliveryFailureItems_().filter(function(errorItem) {
    return normalizeDeliveryEmail_(errorItem.email) === email;
  }).map(deliveryFailureToHistoryItem_).sort(function(a, b) {
    const aDate = deliveryHistoryDate_(a.lastOccurredAt || a.occurredAt);
    const bDate = deliveryHistoryDate_(b.lastOccurredAt || b.occurredAt);
    return (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0);
  });
  const errorDates = [];
  errors.forEach(function(errorEntry) {
    const first = deliveryHistoryDate_(errorEntry.firstOccurredAt || errorEntry.occurredAt);
    const last = deliveryHistoryDate_(errorEntry.lastOccurredAt || errorEntry.occurredAt);
    if (first) errorDates.push(first);
    if (last) errorDates.push(last);
  });
  const earliestErrorDate = errorDates.length ? new Date(Math.min.apply(null, errorDates.map(function(date) { return date.getTime(); }))) : deliveryHistoryDate_(item.firstOccurredAt || item.occurredAt);
  const latestErrorDate = errorDates.length ? new Date(Math.max.apply(null, errorDates.map(function(date) { return date.getTime(); }))) : deliveryHistoryDate_(item.lastOccurredAt || item.occurredAt);
  const successful = normal.filter(function(entry) {
    return (entry.delivered || /配信完了|delivered|送信完了|送信成功|成功/i.test(String(entry.status || ''))) &&
      deliveryRecoveryEntryMatchesFailure_(Object.assign({email:email}, entry), item);
  });
  const afterLatest = successful.filter(function(entry) {
    const date = deliveryHistoryDate_(entry.finalAt) || deliveryHistoryDate_(entry.occurredAt);
    return date && latestErrorDate && date.getTime() > latestErrorDate.getTime();
  }).slice(0, 5).map(function(entry) {
    return Object.assign({}, entry, {relation:'afterLatestError'});
  });
  const beforeFirst = successful.filter(function(entry) {
    const date = deliveryHistoryDate_(entry.finalAt) || deliveryHistoryDate_(entry.occurredAt);
    return date && earliestErrorDate && date.getTime() < earliestErrorDate.getTime();
  }).slice(0, 5).map(function(entry) {
    return Object.assign({}, entry, {relation:'beforeFirstError'});
  });
  const items = afterLatest.concat(errors, beforeFirst);
  return {
    email:email,
    anchorDay:deliveryHistoryDayKey_(latestErrorDate),
    errorStartDay:deliveryHistoryDayKey_(earliestErrorDate),
    errorEndDay:deliveryHistoryDayKey_(latestErrorDate),
    afterLatestCount:afterLatest.length,
    beforeFirstCount:beforeFirst.length,
    recovered:afterLatest.length > 0,
    sendCount:afterLatest.length + beforeFirst.length,
    errorCount:errors.length,
    itemCount:items.length,
    items:items
  };
}
