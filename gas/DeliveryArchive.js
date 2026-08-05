/** 入退室メール履歴の2年保持・年度別自動保管 */
const DELIVERY_HISTORY_RETENTION_YEARS = 2;
const DELIVERY_HISTORY_ARCHIVE_INDEX_PROPERTY = 'DELIVERY_HISTORY_ARCHIVE_INDEX';
const DELIVERY_HISTORY_ARCHIVE_FOLDER_PROPERTY = 'DELIVERY_HISTORY_ARCHIVE_FOLDER_ID';
const DELIVERY_HISTORY_ARCHIVE_LAST_CHECK_PROPERTY = 'DELIVERY_HISTORY_ARCHIVE_LAST_CHECK';
const DELIVERY_HISTORY_ARCHIVE_CHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const DELIVERY_HISTORY_ARCHIVE_SHEETS = [
  {name:'ログ', dateHeaders:['タイムスタンプ','受付日時','登録日時']},
  {name:'メール送信キュー', dateHeaders:['登録日時','受付日時','更新日時']}
];
const DELIVERY_HISTORY_ARCHIVE_KEY_HEADER = '保管元行キー';

function deliveryHistoryArchiveDate_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && isFinite(value)) {
    const numeric = value > 100000000000 ? value : value * 1000;
    const parsedNumber = new Date(numeric);
    return isNaN(parsedNumber.getTime()) ? null : parsedNumber;
  }
  const parsed = new Date(String(value || ''));
  return isNaN(parsed.getTime()) ? null : parsed;
}

function deliveryHistoryArchiveCutoff_(now) {
  const cutoff = new Date((now instanceof Date ? now : new Date()).getTime());
  cutoff.setFullYear(cutoff.getFullYear() - DELIVERY_HISTORY_RETENTION_YEARS);
  return cutoff;
}

function deliveryHistoryArchiveYear_(value) {
  const date = deliveryHistoryArchiveDate_(value);
  return date ? Number(Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy')) : 0;
}

function deliveryHistoryArchiveIndex_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty(DELIVERY_HISTORY_ARCHIVE_INDEX_PROPERTY) || '{}');
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (ignore) {
    return {};
  }
}

function deliveryHistoryArchiveFolder_() {
  const props = PropertiesService.getScriptProperties();
  const existingId = String(props.getProperty(DELIVERY_HISTORY_ARCHIVE_FOLDER_PROPERTY) || '').trim();
  if (existingId) {
    try { return DriveApp.getFolderById(existingId); } catch (ignore) {}
  }
  const folder = DriveApp.createFolder('入退室メール履歴保管（年度別）');
  props.setProperty(DELIVERY_HISTORY_ARCHIVE_FOLDER_PROPERTY, folder.getId());
  return folder;
}

function deliveryHistoryArchiveSpreadsheet_(year) {
  const props = PropertiesService.getScriptProperties();
  const index = deliveryHistoryArchiveIndex_();
  const key = String(year);
  if (index[key]) {
    try { return SpreadsheetApp.openById(index[key]); } catch (ignore) {}
  }
  const archive = SpreadsheetApp.create('入退室メール履歴保管_' + key);
  try { DriveApp.getFileById(archive.getId()).moveTo(deliveryHistoryArchiveFolder_()); } catch (ignore) {}
  if (typeof getCheckInShareEmails_ === 'function') {
    getCheckInShareEmails_().forEach(function(email) {
      try { archive.addEditor(email); } catch (ignore) {}
    });
  }
  index[key] = archive.getId();
  props.setProperty(DELIVERY_HISTORY_ARCHIVE_INDEX_PROPERTY, JSON.stringify(index));
  return archive;
}

function deliveryHistoryArchiveSheet_(archive, sourceName, headers) {
  let sheet = archive.getSheetByName(sourceName);
  if (!sheet) sheet = archive.insertSheet(sourceName);
  const archiveHeaders = headers.concat([DELIVERY_HISTORY_ARCHIVE_KEY_HEADER]);
  if (sheet.getMaxColumns() < archiveHeaders.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), archiveHeaders.length - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, archiveHeaders.length).setValues([archiveHeaders]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function deliveryHistoryArchiveRowKey_(sheetName, headers, row) {
  const serialized = [sheetName].concat(headers.map(function(header, index) {
    const value = row[index];
    return value instanceof Date ? value.toISOString() : String(value == null ? '' : value);
  })).join('\u001f');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, serialized, Utilities.Charset.UTF_8);
  return bytes.map(function(value) { return ('0' + ((value + 256) % 256).toString(16)).slice(-2); }).join('');
}

function deliveryHistoryDateColumn_(headers, candidates) {
  const normalized = headers.map(function(value) { return String(value || '').trim(); });
  for (let i = 0; i < candidates.length; i++) {
    const index = normalized.indexOf(candidates[i]);
    if (index >= 0) return index;
  }
  return -1;
}

function deliveryHistoryDeleteRows_(sheet, rowNumbers) {
  const sorted = rowNumbers.slice().sort(function(a, b) { return b - a; });
  let rangeBottom = null;
  let rangeTop = null;
  sorted.forEach(function(rowNumber) {
    if (rangeBottom == null) {
      rangeBottom = rowNumber;
      rangeTop = rowNumber;
    } else if (rowNumber === rangeTop - 1) {
      rangeTop = rowNumber;
    } else {
      sheet.deleteRows(rangeTop, rangeBottom - rangeTop + 1);
      rangeBottom = rowNumber;
      rangeTop = rowNumber;
    }
  });
  if (rangeBottom != null) sheet.deleteRows(rangeTop, rangeBottom - rangeTop + 1);
}

function deliveryHistoryArchiveOneSheet_(sourceSheet, config, cutoff) {
  if (!sourceSheet || sourceSheet.getLastRow() < 2) return {sheet:config.name, moved:0};
  const values = sourceSheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const dateColumn = deliveryHistoryDateColumn_(headers, config.dateHeaders);
  if (dateColumn < 0) throw new Error(config.name + 'の保管基準日列が見つかりません');
  const groups = {};
  values.slice(1).forEach(function(row, index) {
    const date = deliveryHistoryArchiveDate_(row[dateColumn]);
    if (!date || date.getTime() >= cutoff.getTime()) return;
    const year = deliveryHistoryArchiveYear_(date);
    if (!year) return;
    if (!groups[year]) groups[year] = [];
    groups[year].push({rowNumber:index + 2, values:row, key:deliveryHistoryArchiveRowKey_(config.name, headers, row)});
  });
  const deletable = [];
  Object.keys(groups).sort().forEach(function(year) {
    const archiveSheet = deliveryHistoryArchiveSheet_(deliveryHistoryArchiveSpreadsheet_(year), config.name, headers);
    const keyColumn = headers.length + 1;
    const existingKeys = archiveSheet.getLastRow() < 2 ? {} : archiveSheet.getRange(2, keyColumn, archiveSheet.getLastRow() - 1, 1).getDisplayValues().reduce(function(result, row) {
      result[String(row[0])] = true;
      return result;
    }, {});
    const newItems = groups[year].filter(function(item) { return !existingKeys[item.key]; });
    if (newItems.length) {
      const appendAt = archiveSheet.getLastRow() + 1;
      archiveSheet.getRange(appendAt, 1, newItems.length, keyColumn).setValues(newItems.map(function(item) {
        return item.values.concat([item.key]);
      }));
      SpreadsheetApp.flush();
    }
    const confirmedKeys = archiveSheet.getRange(2, keyColumn, Math.max(archiveSheet.getLastRow() - 1, 1), 1).getDisplayValues().reduce(function(result, row) {
      result[String(row[0])] = true;
      return result;
    }, {});
    groups[year].forEach(function(item) { if (confirmedKeys[item.key]) deletable.push(item.rowNumber); });
  });
  deliveryHistoryDeleteRows_(sourceSheet, deletable);
  return {sheet:config.name, moved:deletable.length};
}

function archiveOldDeliveryHistory() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return {ok:true, skipped:'already_running'};
  try {
    const source = getDeliveryFailureSpreadsheet_();
    const cutoff = deliveryHistoryArchiveCutoff_(new Date());
    const results = DELIVERY_HISTORY_ARCHIVE_SHEETS.map(function(config) {
      return deliveryHistoryArchiveOneSheet_(source.getSheetByName(config.name), config, cutoff);
    });
    PropertiesService.getScriptProperties().setProperty(DELIVERY_HISTORY_ARCHIVE_LAST_CHECK_PROPERTY, String(Date.now()));
    return {ok:true, retentionYears:DELIVERY_HISTORY_RETENTION_YEARS, cutoff:cutoff, results:results, archiveFolderUrl:deliveryHistoryArchiveFolder_().getUrl()};
  } finally {
    lock.releaseLock();
  }
}

function maybeArchiveDeliveryHistory_() {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty(DELIVERY_HISTORY_ARCHIVE_LAST_CHECK_PROPERTY) || 0);
  if (last && Date.now() - last < DELIVERY_HISTORY_ARCHIVE_CHECK_INTERVAL_MS) return {ok:true, skipped:'recently_checked'};
  return archiveOldDeliveryHistory();
}

function setupDeliveryHistoryArchive() {
  const handler = 'archiveOldDeliveryHistory';
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) { return trigger.getHandlerFunction() === handler; });
  if (!exists) ScriptApp.newTrigger(handler).timeBased().everyMonths(1).onMonthDay(2).atHour(3).create();
  const result = archiveOldDeliveryHistory();
  result.triggerCreated = !exists;
  return result;
}

function getDeliveryHistorySourceSheets_(sheetName) {
  const sheets = [];
  const active = getDeliveryFailureSpreadsheet_().getSheetByName(sheetName);
  if (active) sheets.push(active);
  const index = deliveryHistoryArchiveIndex_();
  Object.keys(index).sort().reverse().forEach(function(year) {
    try {
      const archived = SpreadsheetApp.openById(index[year]).getSheetByName(sheetName);
      if (archived) sheets.push(archived);
    } catch (ignore) {}
  });
  return sheets;
}
