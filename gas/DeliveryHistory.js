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
  const sheet = getDeliveryFailureSpreadsheet_().getSheetByName('メール送信キュー');
  if (!sheet || sheet.getLastRow() < 2) return result;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  values.slice(1).forEach(function(row) {
    const receiptId = String(deliveryHistoryCell_(row, headers, ['受付ID']) || '').trim();
    if (!receiptId) return;
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
  return result;
}

function readNormalDeliveryHistoryForEmail_(email) {
  const sheet = getDeliveryFailureLogSheet_();
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const targetEmail = normalizeDeliveryEmail_(email);
  const queueRecipientsByReceipt = readDeliveryQueueRecipientsByReceipt_();
  return values.slice(1).map(function(row, index) {
    const receiptId = String(deliveryHistoryCell_(row, headers, ['受付ID']) || '').trim();
    const queueRecipients = queueRecipientsByReceipt[receiptId] || [];
    if (!deliveryHistoryRowHasEmail_(row, targetEmail) && queueRecipients.indexOf(targetEmail) < 0) return null;
    const occurredAt = deliveryHistoryCell_(row, headers, ['受付日時','タイムスタンプ','登録日時','送信完了日時','更新日時']);
    const occurredDate = deliveryHistoryDate_(occurredAt);
    if (!occurredDate) return null;
    const deliveredAt = deliveryHistoryCell_(row, headers, ['最終配信成功日時','送信完了日時']);
    const status = String(deliveryHistoryCell_(row, headers, ['配信状態','状態','メール送信結果']) || '').trim();
    const mailType = String(deliveryHistoryCell_(row, headers, ['送信種別','種別']) || '').trim();
    return {
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
  }).filter(Boolean);
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
    return entry.delivered || /配信完了|delivered|送信完了|送信成功|成功/i.test(String(entry.status || ''));
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
