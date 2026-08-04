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

function readNormalDeliveryHistoryForEmail_(email) {
  const sheet = getDeliveryFailureLogSheet_();
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  return values.slice(1).map(function(row, index) {
    if (!deliveryHistoryRowHasEmail_(row, email)) return null;
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
    id:item.id,
    occurredAt:item.occurredAt,
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
  const anchorDay = deliveryHistoryDayKey_(item.occurredAt || item.lastOccurredAt || new Date());
  const normal = readNormalDeliveryHistoryForEmail_(email).sort(function(a, b) {
    return deliveryHistoryDate_(b.occurredAt).getTime() - deliveryHistoryDate_(a.occurredAt).getTime();
  });
  const sameDay = normal.filter(function(entry) { return deliveryHistoryDayKey_(entry.occurredAt) === anchorDay; });
  const before = normal.filter(function(entry) { return deliveryHistoryDayKey_(entry.occurredAt) < anchorDay; }).slice(0, 5);
  const errors = readDeliveryFailureItems_().filter(function(errorItem) {
    return normalizeDeliveryEmail_(errorItem.email) === email;
  }).map(deliveryFailureToHistoryItem_);
  const items = sameDay.concat(before, errors).sort(function(a, b) {
    const aDate = deliveryHistoryDate_(a.occurredAt);
    const bDate = deliveryHistoryDate_(b.occurredAt);
    return (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0);
  });
  return {
    email:email,
    anchorDay:anchorDay,
    sendCount:sameDay.length + before.length,
    errorCount:errors.length,
    itemCount:items.length,
    items:items
  };
}
