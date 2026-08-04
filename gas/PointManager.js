/**
 * STEP ポイント管理 API
 * 既存の「ポイント履歴」5列を正本として維持し、監査情報は別シートへ保存する。
 */
const PM_MASTER_SS_ID = '1CIJkTlYUcUkbb8jBdFc6L8D5ubTGsxwNxFv01ten-Zk';
const PM_MASTER_SHEET = '☆マスタ';
const PM_ATTENDANCE_SS_ID = '1VyQ3O69PDArG2bJt_Qf347rlTwKfjqM6KPLDWqIPo6A';
const PM_POINTS_SHEET = 'ポイント履歴';
const PM_AUDIT_SHEET = 'ポイント操作ログ';
const PM_WRITE_LEVELS = ['2', '3', '4'];
const PM_SETTINGS_LEVELS = ['4'];
const PM_STAFF_AUTH_API_URL = 'https://script.google.com/macros/s/AKfycbypkUc0MqZ07E7pZRglNPeRM56WbCcuWaLpRzi9bVFcPklHDxaaLC7GfzG6ozTGCbEX/exec';
const PM_ACTIONS = [
  'pointManagerBootstrap', 'pointManagerStudent', 'pointManagerHistory', 'pointManagerApply',
  'pointManagerEdit', 'pointManagerCancel', 'pointManagerGetSettings',
  'pointManagerSaveSettings'
];

function isPointManagerApiAction_(action) {
  return PM_ACTIONS.indexOf(String(action || '')) >= 0;
}

function handlePointManagerApiAction_(body) {
  try {
    const staff = pmVerifySystemPortalSession_(body);
    const level = String(staff.permissionLevel || '').trim();
    const context = {
      code: String(staff.loginId || staff.code || body.staffLoginId || '').trim(),
      name: String(staff.name || '').trim(),
      level: level
    };
    if (body.action === 'pointManagerBootstrap') return pmBootstrap_(context);
    if (body.action === 'pointManagerStudent') return pmStudentDetail_(context, body);
    if (body.action === 'pointManagerHistory') return pmGlobalHistory_(context, body);
    if (body.action === 'pointManagerGetSettings') return pmGetSettingsResult_(context);
    if (body.action === 'pointManagerSaveSettings') {
      pmRequireLevel_(context, PM_SETTINGS_LEVELS);
      return pmSaveSettings_(context, body);
    }
    pmRequireLevel_(context, PM_WRITE_LEVELS);
    if (body.action === 'pointManagerApply') return pmApply_(context, body);
    if (body.action === 'pointManagerEdit') return pmEdit_(context, body);
    if (body.action === 'pointManagerCancel') return pmCancel_(context, body);
    throw new Error('不明な操作です。');
  } catch (error) {
    console.error('point-manager error', error && error.stack ? error.stack : error);
    return { ok: false, message: error && error.message ? error.message : '処理に失敗しました。' };
  }
}

function pmVerifySystemPortalSession_(body) {
  const token = String(body.systemPortalSessionToken || body.sessionToken || '').trim();
  const requestedLoginId = String(body.staffLoginId || '').trim();
  if (!token) throw new Error('スタッフログインが必要です。');
  const response = UrlFetchApp.fetch(PM_STAFF_AUTH_API_URL, {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify({
      action: 'verifySystemPortal',
      systemPortalSessionToken: token
    }),
    muteHttpExceptions: true,
    followRedirects: true
  });
  let verified;
  try { verified = JSON.parse(response.getContentText()); } catch (error) { verified = null; }
  if (!verified || verified.success !== true) {
    throw new Error((verified && (verified.error || verified.message)) || 'スタッフログインの有効期限が切れました。もう一度ログインしてください。');
  }
  const loginId = String(verified.loginId || verified.code || '').trim();
  const level = String(verified.permissionLevel || '').trim();
  if (!loginId || PM_WRITE_LEVELS.indexOf(level) < 0) throw new Error('この機能を利用する権限がありません。');
  if (requestedLoginId && loginId !== requestedLoginId) throw new Error('セッションの利用者が一致しません。');
  return {
    loginId: loginId,
    code: loginId,
    name: String(verified.name || '').trim(),
    permissionLevel: level,
    expiresAt: String(verified.expiresAt || verified.systemPortalExpiresAt || '')
  };
}

function pmRequireLevel_(staff, allowed) {
  if (allowed.indexOf(String(staff.level || '')) < 0) throw new Error('この操作を行う権限がありません。');
}

function pmSpreadsheet_() { return SpreadsheetApp.openById(PM_ATTENDANCE_SS_ID); }
function pmPointsSheet_() {
  const sheet = pmSpreadsheet_().getSheetByName(PM_POINTS_SHEET);
  if (!sheet) throw new Error('ポイント履歴シートが見つかりません。');
  const header = sheet.getRange(1, 1, 1, 5).getDisplayValues()[0];
  if (header.join('|') !== '日付|生徒番号|生徒氏名|ポイント|理由') {
    throw new Error('ポイント履歴の列構成が想定と異なります。');
  }
  return sheet;
}

function pmAuditSheet_() {
  const ss = pmSpreadsheet_();
  let sheet = ss.getSheetByName(PM_AUDIT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PM_AUDIT_SHEET);
    sheet.getRange(1, 1, 1, 15).setValues([[
      '実行日時','操作ID','リクエストID','操作種別','対象操作ID','生徒番号','生徒氏名',
      '変更前日付','変更前ポイント','変更前コメント','変更後日付','変更後ポイント','変更後コメント',
      '実行スタッフ','AK'
    ]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function pmMasterRows_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('PM_MASTER_V5');
  if (cached) {
    try { return JSON.parse(cached); } catch (ignore) {}
  }
  const sheet = SpreadsheetApp.openById(PM_MASTER_SS_ID).getSheetByName(PM_MASTER_SHEET);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, 15).getValues().map(function(row) {
    const id = String(row[0] || '').trim();
    const name = String(row[4] || '').trim();
    const enrollmentFlag = String(row[1] || '').trim();
    const status = enrollmentFlag === '1' ? '在籍' : (enrollmentFlag === '0' ? '退塾予定' : '退塾');
    return {
      id: id, name: name, kana: String(row[5] || '').trim(), campus: String(row[7] || '').trim(),
      grade: String(row[10] || row[9] || '').trim(), status: status,
      active: !!id && !!name && (enrollmentFlag === '1' || enrollmentFlag === '0')
    };
  }).filter(function(row) { return row.id && row.name; });
  cache.put('PM_MASTER_V5', JSON.stringify(rows), 300);
  return rows;
}

function pmPointRows_() {
  const sheet = pmPointsSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 5).getValues().map(function(row, index) {
    const reason = String(row[4] || '');
    const op = (reason.match(/\[PM:([^\]]+)\]/) || [,''])[1];
    return {
      row: index + 2,
      date: pmDate_(row[0]), id: String(row[1] || '').trim(), name: String(row[2] || '').trim(),
      points: Number(row[3]) || 0, reason: reason, operationId: op || ('ROW:' + (index + 2)),
      type: pmType_(reason, Number(row[3]) || 0),
      editable: pmType_(reason, Number(row[3]) || 0) === '入退室' || (!!op && /^\[(特別|使用)\]/.test(reason))
    };
  }).filter(function(row) { return row.id && row.points; });
}

function pmBootstrap_(staff) {
  const students = pmMasterRows_();
  const rows = pmPointRows_();
  const nowMonth = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  const sums = {};
  rows.forEach(function(row) {
    const rec = sums[row.id] || (sums[row.id] = { total: 0, month: 0 });
    rec.total += row.points;
    if (row.date.indexOf(nowMonth) === 0 && row.points > 0) rec.month += row.points;
  });
  return {
    ok: true, staff: staff, settings: pmSettings_(),
    students: students.map(function(student) {
      const sum = sums[student.id] || { total: 0, month: 0 };
      return Object.assign({}, student, { points: Math.max(0, sum.total), monthPoints: sum.month });
    })
  };
}

function pmStudentDetail_(staff, body) {
  const id = String(body.studentId || '').trim();
  const student = pmMasterRows_().find(function(row) { return row.id === id; });
  if (!student) throw new Error('生徒が見つかりません。');
  const limit = [20, 50, 100].indexOf(Number(body.limit)) >= 0 ? Number(body.limit) : 20;
  const rows = pmPointRows_().filter(function(row) { return row.id === id; });
  const month = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  const summary = { total: 0, month: 0, attendance: 0, special: 0, used: 0 };
  rows.forEach(function(row) {
    summary.total += row.points;
    if (row.date.indexOf(month) !== 0) return;
    summary.month += row.points;
    if (row.type === '入退室') summary.attendance += row.points;
    else if (row.type === '使用') summary.used += Math.abs(row.points);
    else summary.special += row.points;
  });
  summary.total = Math.max(0, summary.total);
  return { ok: true, student: student, summary: summary, history: rows.reverse().slice(0, limit), staff: staff };
}

function pmGlobalHistory_(staff, body) {
  const mode = String(body.mode || '').trim();
  if (['attendance', 'special', 'use', 'all'].indexOf(mode) < 0) throw new Error('履歴種別が不正です。');
  const rows = pmPointRows_().filter(function(row) {
    if (mode === 'all') return true;
    if (mode === 'attendance') return row.type === '入退室';
    if (mode === 'special') return row.type === '特別';
    return row.type === '使用';
  }).sort(function(a, b) {
    return b.date.localeCompare(a.date) || b.row - a.row;
  });
  return { ok: true, mode: mode, history: rows, count: rows.length, staff: staff };
}

function pmApply_(staff, body) {
  const requestId = pmRequestId_(body.requestId);
  const mode = String(body.mode || '');
  if (['special', 'use'].indexOf(mode) < 0) throw new Error('操作種別が不正です。');
  const amount = Number(body.points);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('ポイントは1以上の整数で入力してください。');
  const reason = String(body.reason || '').trim();
  if (!reason) throw new Error('理由・コメントは必須です。');
  const date = pmInputDate_(body.date);
  const ids = Array.isArray(body.studentIds) ? body.studentIds.map(String) : [];
  if (!ids.length) throw new Error('対象生徒を選択してください。');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const prior = pmFindRequest_(requestId);
    if (prior) return prior;
    const master = pmMasterRows_();
    const pointRows = pmPointRows_();
    const balance = {};
    pointRows.forEach(function(row) { balance[row.id] = (balance[row.id] || 0) + row.points; });
    const output = [], pointValues = [], auditValues = [];
    ids.forEach(function(id) {
      const student = master.find(function(row) { return row.id === String(id); });
      if (!student) throw new Error('生徒番号 ' + id + ' が見つかりません。');
      const before = Math.max(0, balance[student.id] || 0);
      const actual = mode === 'use' ? Math.min(before, amount) : amount;
      if (actual <= 0) throw new Error(student.name + 'さんの使用可能ポイントがありません。');
      const delta = mode === 'use' ? -actual : actual;
      const op = Utilities.getUuid();
      const label = mode === 'use' ? '使用' : '特別';
      const storedReason = '[' + label + '][PM:' + op + '] ' + reason;
      pointValues.push([date, student.id, student.name, delta, storedReason]);
      auditValues.push(pmAuditRow_(staff, op, requestId, label, '', student, '', '', '', date, delta, reason));
      balance[student.id] = before + delta;
      output.push({ id: student.id, name: student.name, before: before, change: delta, after: Math.max(0, before + delta), operationId: op });
    });
    pmPointsSheet_().getRange(pmPointsSheet_().getLastRow() + 1, 1, pointValues.length, 5).setValues(pointValues);
    pmAppendAudits_(auditValues);
    CacheService.getScriptCache().put('PM_RESULT:' + requestId, JSON.stringify({ ok: true, results: output }), 600);
    return { ok: true, results: output };
  } finally { lock.releaseLock(); }
}

function pmEdit_(staff, body) {
  return pmRevise_(staff, body, false);
}

function pmCancel_(staff, body) {
  return pmRevise_(staff, body, true);
}

function pmRevise_(staff, body, cancel) {
  const requestId = pmRequestId_(body.requestId);
  const operationId = String(body.operationId || '').trim();
  if (!operationId) throw new Error('対象記録を特定できません。');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const prior = pmFindRequest_(requestId); if (prior) return prior;
    const original = pmPointRows_().find(function(row) { return row.operationId === operationId; });
    if (!original || !original.editable) throw new Error('この記録は編集・取消できません。');
    const reason = cancel ? String(body.reason || '取消').trim() : String(body.reason || '').trim();
    if (!reason) throw new Error('理由・コメントは必須です。');
    const master = pmMasterRows_();
    const student = master.find(function(row) { return row.id === original.id; }) || { id: original.id, name: original.name };
    const balances = {}; pmPointRows_().forEach(function(row) { balances[row.id] = (balances[row.id] || 0) + row.points; });
    const values = [], audits = [];
    const reverseOp = Utilities.getUuid();
    values.push([pmToday_(), student.id, student.name, -original.points, '[訂正][PM:' + reverseOp + '] 元記録 ' + operationId + ' を相殺: ' + reason]);
    let newOp = '', finalPoints = 0, newDate = '', newReason = '';
    if (!cancel) {
      newDate = pmInputDate_(body.date);
      const rawPoints = body.points;
      const requested = Number(rawPoints);
      if (rawPoints === '' || rawPoints == null || !Number.isInteger(requested)) throw new Error('整数を入力してください。');
      finalPoints = requested;
      const isAttendance = original.type === '入退室';
      if (isAttendance && requested < 0) throw new Error('レギュラー付与ポイントは0以上の整数で入力してください。');
      const kind = isAttendance ? '入退室' : (requested < 0 ? '使用' : '特別');
      if (!isAttendance && requested < 0) {
        const afterReverse = Math.max(0, (balances[student.id] || 0) - original.points);
        finalPoints = -Math.min(afterReverse, Math.abs(requested));
        if (finalPoints === 0) throw new Error('使用可能ポイントがありません。');
      }
      newOp = Utilities.getUuid(); newReason = reason;
      values.push([newDate, student.id, student.name, finalPoints, '[' + kind + '][PM:' + newOp + '] ' + reason]);
    }
    const action = cancel ? '取消' : '編集';
    audits.push(pmAuditRow_(staff, reverseOp, requestId, action, operationId, student, original.date, original.points, original.reason, newDate, finalPoints, newReason));
    pmPointsSheet_().getRange(pmPointsSheet_().getLastRow() + 1, 1, values.length, 5).setValues(values);
    pmAppendAudits_(audits);
    return { ok: true, operationId: newOp, canceled: cancel };
  } finally { lock.releaseLock(); }
}

function pmSettings_() {
  const p = PropertiesService.getScriptProperties();
  return {
    enabled: String(p.getProperty('POINTS_ENABLED') || 'true') !== 'false',
    timing: String(p.getProperty('POINT_AWARD_TIMING') || 'exit') === 'entry' ? 'entry' : 'exit',
    dailyLimit: String(p.getProperty('POINT_DAILY_LIMIT') || 'once') === 'none' ? 'none' : 'once',
    minMinutes: Math.max(0, Number(p.getProperty('MIN_STAY_MINUTES')) || 10),
    perVisit: Math.max(1, Math.floor(Number(p.getProperty('POINTS_PER_VISIT')) || 1))
  };
}

function pmGetSettingsResult_(staff) { return { ok: true, settings: pmSettings_(), canEdit: staff.level === '4' }; }

function pmSaveSettings_(staff, body) {
  const s = body.settings || {};
  const next = {
    enabled: !!s.enabled,
    timing: s.timing === 'entry' ? 'entry' : 'exit',
    dailyLimit: s.dailyLimit === 'none' ? 'none' : 'once',
    minMinutes: Number(s.minMinutes), perVisit: Number(s.perVisit)
  };
  if (!Number.isInteger(next.minMinutes) || next.minMinutes < 0 || next.minMinutes > 1440) throw new Error('必要滞在時間が不正です。');
  if (!Number.isInteger(next.perVisit) || next.perVisit < 1 || next.perVisit > 10000) throw new Error('付与ポイントが不正です。');
  const before = pmSettings_();
  const p = PropertiesService.getScriptProperties();
  p.setProperties({
    POINTS_ENABLED: String(next.enabled), POINT_AWARD_TIMING: next.timing,
    POINT_DAILY_LIMIT: next.dailyLimit, MIN_STAY_MINUTES: String(next.minMinutes),
    POINTS_PER_VISIT: String(next.perVisit)
  }, false);
  pmAppendAudits_([pmAuditRow_(staff, Utilities.getUuid(), pmRequestId_(body.requestId), '設定変更', '', {id:'',name:''}, '', '', JSON.stringify(before), '', '', JSON.stringify(next))]);
  return { ok: true, before: before, settings: next };
}

function pmRequestId_(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(id)) throw new Error('リクエストIDが不正です。');
  return id;
}

function pmFindRequest_(requestId) {
  const cache = CacheService.getScriptCache().get('PM_RESULT:' + requestId);
  if (cache) { try { return JSON.parse(cache); } catch (ignore) {} }
  const sheet = pmAuditSheet_(), last = sheet.getLastRow();
  if (last < 2) return null;
  const finder = sheet.getRange(2, 3, last - 1, 1).createTextFinder(requestId).matchEntireCell(true).findNext();
  return finder ? { ok: true, duplicate: true } : null;
}

function pmAuditRow_(staff, op, requestId, action, targetOp, student, beforeDate, beforePoints, beforeReason, afterDate, afterPoints, afterReason) {
  return [new Date(), op, requestId, action, targetOp, student.id, student.name, beforeDate, beforePoints, beforeReason, afterDate, afterPoints, afterReason, staff.code + ' ' + staff.name, staff.level];
}
function pmAppendAudits_(rows) { if (rows.length) pmAuditSheet_().getRange(pmAuditSheet_().getLastRow()+1,1,rows.length,15).setValues(rows); }
function pmDate_(value) { return value instanceof Date ? Utilities.formatDate(value,'Asia/Tokyo','yyyy-MM-dd') : String(value || '').slice(0,10); }
function pmToday_() { return Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd'); }
function pmInputDate_(value) { const s=String(value||'').trim(); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日付を確認してください。'); return s; }
function pmType_(reason, points) { if (/^\[使用\]/.test(reason) || (points < 0 && !/^\[訂正\]/.test(reason))) return '使用'; if (/^\[(特別|訂正|取消)\]/.test(reason)) return '特別'; return '入退室'; }

