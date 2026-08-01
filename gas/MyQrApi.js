/**
 * STEP塾生用「自分のQR」専用API。
 * 既存スタッフ用管理GETは requireQrStaffSession_ で保護し、
 * 塾生用の本人QR取得はこのファイルのPOSTアクションだけを使用する。
 */

const MY_QR_SESSION_SECONDS = 6 * 60 * 60;
const MY_QR_SESSION_PREFIX = 'MY_QR_SESSION_V1:';
const MY_QR_LOGIN_FAILURE_PREFIX = 'MY_QR_LOGIN_FAILURE_V1:';
const MY_QR_MAX_LOGIN_FAILURES = 5;
const MY_QR_LOGIN_LOCK_SECONDS = 10 * 60;
const MY_QR_STAFF_PERMISSION_LEVELS = ['2', '3', '4'];
const MY_QR_STUDENT_AUTH_SOURCE = 'https://stepkobetsu-hub.github.io/foresta-step-progress/';
const MY_QR_STAFF_AUTH_SOURCE = 'https://stepkobetsu-hub.github.io/student-QR/student_qr_register.html';
const MY_QR_ATTENDANCE_SS_ID = '1VyQ3O69PDArG2bJt_Qf347rlTwKfjqM6KPLDWqIPo6A';

function isMyQrApiAction_(action) {
  return ['myQrLogin', 'myQrCommonLogin', 'myQrCommonGet', 'myQrGet', 'myQrLogout', 'myQrCommonLogout'].indexOf(String(action || '')) >= 0;
}

function handleMyQrApiAction_(body) {
  try {
    if (body.action === 'myQrLogin') return myQrLogin_(body);
    if (body.action === 'myQrCommonLogin') return myQrCommonLogin_(body);
    if (body.action === 'myQrCommonGet') return myQrCommonGet_(body);
    if (body.action === 'myQrGet') return myQrGet_(body);
    if (body.action === 'myQrLogout') return myQrLogout_(body);
    if (body.action === 'myQrCommonLogout') return myQrCommonLogout_(body);
    return { ok: false, code: 'BAD_REQUEST', message: '不明な操作です。' };
  } catch (error) {
    console.error('my-qr-api error', error && error.stack ? error.stack : error);
    return {
      ok: false,
      code: error && error.publicCode ? error.publicCode : 'INTERNAL_ERROR',
      message: error && error.publicMessage ? error.publicMessage : '処理に失敗しました。時間をおいて再度お試しください。'
    };
  }
}

function myQrLogin_(body) {
  const studentId = String(body.studentId || '').trim();
  const password = String(body.password || '');
  if (!studentId || !password) {
    throw myQrPublicError_('生徒番号とパスワードを入力してください。', 'LOGIN_REQUIRED');
  }

  const cache = CacheService.getScriptCache();
  const failureKey = MY_QR_LOGIN_FAILURE_PREFIX + myQrHash_(studentId);
  const failureCount = Number(cache.get(failureKey) || 0);
  if (failureCount >= MY_QR_MAX_LOGIN_FAILURES) {
    throw myQrPublicError_('ログインを一時停止しています。10分後にもう一度お試しください。', 'LOGIN_LOCKED');
  }

  const authenticated = myQrAuthenticateStudent_(studentId, password);
  const record = authenticated && myQrFindStudent_(authenticated.studentId);
  const valid = authenticated && record;
  if (!valid) {
    cache.put(failureKey, String(failureCount + 1), MY_QR_LOGIN_LOCK_SECONDS);
    throw myQrPublicError_('生徒番号またはパスワードが違います。', 'INVALID_CREDENTIALS');
  }
  cache.remove(failureKey);

  const session = myQrCreateSession_(record.studentId, authenticated.token);
  session.commonToken = authenticated.token;
  session.commonExpiresAt = authenticated.expiresAt;
  Object.assign(session, myQrBuildResponse_(record, session.expiresAt));
  return session;
}

function myQrCommonGet_(body) {
  const commonToken = String(body.commonToken || '').trim();
  if (!commonToken) throw myQrPublicError_('ログインが必要です。', 'UNAUTHENTICATED');
  const result = myQrPostJson_(myQrResolveApiUrl_('MY_QR_STUDENT_AUTH_API_URL', MY_QR_STUDENT_AUTH_SOURCE, 'API_URL'), {
    action: 'getCommonStudentSession',
    token: commonToken
  });
  const studentId = String(result && result.profile && result.profile.studentId || '').trim();
  if (!result || !result.success || result.role !== 'STUDENT' || !studentId) {
    throw myQrPublicError_('ログインの有効期限が切れました。もう一度ログインしてください。', 'SESSION_EXPIRED');
  }
  const record = myQrFindStudent_(studentId);
  if (!record) throw myQrPublicError_('利用状態を確認できません。教室へお問い合わせください。', 'STUDENT_INACTIVE');
  return myQrBuildResponse_(record, result.expiresAt || '');
}

function myQrCommonLogin_(body) {
  const commonToken = String(body.commonToken || '').trim();
  if (!commonToken) throw myQrPublicError_('ログインが必要です。', 'UNAUTHENTICATED');
  const result = myQrPostJson_(myQrResolveApiUrl_('MY_QR_STUDENT_AUTH_API_URL', MY_QR_STUDENT_AUTH_SOURCE, 'API_URL'), {
    action: 'getCommonStudentSession',
    token: commonToken
  });
  const studentId = String(result && result.profile && result.profile.studentId || '').trim();
  if (!result || !result.success || result.role !== 'STUDENT' || !studentId) {
    throw myQrPublicError_('ログインの有効期限が切れました。もう一度ログインしてください。', 'SESSION_EXPIRED');
  }
  const record = myQrFindStudent_(studentId);
  if (!record) throw myQrPublicError_('利用状態を確認できません。教室へお問い合わせください。', 'STUDENT_INACTIVE');
  return myQrCreateSession_(record.studentId, commonToken);
}

function myQrCreateSession_(studentId, authToken) {
  const cache = CacheService.getScriptCache();
  const rawToken = Utilities.getUuid() + '-' + Utilities.getUuid();
  const expiresAt = new Date(Date.now() + MY_QR_SESSION_SECONDS * 1000).toISOString();
  cache.put(
    MY_QR_SESSION_PREFIX + myQrHash_(rawToken),
    JSON.stringify({ studentId: String(studentId), expiresAt: expiresAt, authToken: String(authToken) }),
    MY_QR_SESSION_SECONDS
  );
  return { ok: true, token: rawToken, expiresAt: expiresAt };
}

function myQrGet_(body) {
  // body.studentId等は意図的に参照しない。本人IDはセッションだけから決定する。
  const session = myQrRequireSession_(body.token);
  if (!myQrValidateStudentSession_(session)) {
    myQrRevokeToken_(body.token);
    throw myQrPublicError_('ログインの有効期限が切れました。もう一度ログインしてください。', 'SESSION_EXPIRED');
  }
  const record = myQrFindStudent_(session.studentId);
  if (!record) {
    myQrRevokeToken_(body.token);
    throw myQrPublicError_('利用状態を確認できません。教室へお問い合わせください。', 'STUDENT_INACTIVE');
  }
  return myQrBuildResponse_(record, session.expiresAt);
}

function myQrBuildResponse_(record, expiresAt) {
  return {
    ok: true,
    studentId: record.studentId,
    name: record.name,
    campus: record.campus,
    registered: !!record.qrData,
    qrData: record.qrData,
    attendance: myQrGetTodayAttendance_(record.studentId),
    points: myQrGetTotalPoints_(record.studentId),
    expiresAt: String(expiresAt || '')
  };
}

function myQrGetTodayAttendance_(studentId) {
  const logSheet = SpreadsheetApp.openById(MY_QR_ATTENDANCE_SS_ID).getSheetByName('ログ');
  const empty = { date: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'), entryAt: '', exitAt: '' };
  if (!logSheet || logSheet.getLastRow() < 2) return empty;

  const rows = logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 2).getValues();
  const today = empty.date;
  const times = rows.reduce(function(result, row) {
    const timestamp = row[0];
    const code = String(row[1] || '').trim();
    if (!(timestamp instanceof Date) || code !== String(studentId).trim()) return result;
    if (Utilities.formatDate(timestamp, 'Asia/Tokyo', 'yyyy-MM-dd') === today) result.push(timestamp);
    return result;
  }, []).sort(function(a, b) { return a.getTime() - b.getTime(); });

  return {
    date: today,
    entryAt: times.length ? Utilities.formatDate(times[0], 'Asia/Tokyo', 'HH:mm') : '',
    exitAt: times.length >= 2 ? Utilities.formatDate(times[times.length - 1], 'Asia/Tokyo', 'HH:mm') : ''
  };
}

function myQrGetTotalPoints_(studentId) {
  const pointsSheet = SpreadsheetApp.openById(MY_QR_ATTENDANCE_SS_ID).getSheetByName('ポイント履歴');
  if (!pointsSheet || pointsSheet.getLastRow() < 2) return 0;
  const rows = pointsSheet.getRange(2, 2, pointsSheet.getLastRow() - 1, 3).getValues();
  return rows.reduce(function(total, row) {
    return String(row[0] || '').trim() === String(studentId).trim() ? total + (Number(row[2]) || 0) : total;
  }, 0);
}

function myQrLogout_(body) {
  const session = myQrReadSession_(body.token);
  if (session) myQrLogoutStudentSession_(session);
  myQrRevokeToken_(body.token);
  return { ok: true };
}

function myQrCommonLogout_(body) {
  const commonToken = String(body.commonToken || '').trim();
  if (!commonToken) return { ok: true };
  try {
    myQrPostJson_(myQrResolveApiUrl_('MY_QR_STUDENT_AUTH_API_URL', MY_QR_STUDENT_AUTH_SOURCE, 'API_URL'), {
      action: 'logout',
      token: commonToken
    });
  } catch (error) {
    console.warn('upstream common logout failed');
  }
  return { ok: true };
}

function myQrReadSession_(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return null;
  const cached = CacheService.getScriptCache().get(MY_QR_SESSION_PREFIX + myQrHash_(token));
  if (!cached) return null;
  try { return JSON.parse(cached); } catch (error) { return null; }
}

function myQrRequireSession_(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) throw myQrPublicError_('ログインが必要です。', 'UNAUTHENTICATED');
  const cache = CacheService.getScriptCache();
  const key = MY_QR_SESSION_PREFIX + myQrHash_(token);
  const cached = cache.get(key);
  if (!cached) throw myQrPublicError_('ログインの有効期限が切れました。もう一度ログインしてください。', 'SESSION_EXPIRED');
  let session;
  try {
    session = JSON.parse(cached);
  } catch (error) {
    cache.remove(key);
    throw myQrPublicError_('ログインの有効期限が切れました。もう一度ログインしてください。', 'SESSION_EXPIRED');
  }
  if (!session.studentId || !session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    cache.remove(key);
    throw myQrPublicError_('ログインの有効期限が切れました。もう一度ログインしてください。', 'SESSION_EXPIRED');
  }
  return session;
}

function myQrRevokeToken_(rawToken) {
  const token = String(rawToken || '').trim();
  if (token) CacheService.getScriptCache().remove(MY_QR_SESSION_PREFIX + myQrHash_(token));
}

function myQrFindStudent_(studentId) {
  const sheet = getMasterSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const match = sheet.getRange(2, COL_STUDENT_ID, lastRow - 1, 1)
    .createTextFinder(String(studentId))
    .matchEntireCell(true)
    .findNext();
  if (!match) return null;
  const row = sheet.getRange(match.getRow(), 1, 1, COL_QR_DATA).getValues()[0];
  return {
    studentId: String(row[COL_STUDENT_ID - 1] || '').trim(),
    name: String(row[COL_STUDENT_NAME - 1] || '').trim(),
    campus: String(row[COL_SCHOOL - 1] || '').trim(),
    qrData: String(row[COL_QR_DATA - 1] || '').trim()
  };
}

function myQrAuthenticateStudent_(studentId, password) {
  const result = myQrPostJson_(myQrResolveApiUrl_('MY_QR_STUDENT_AUTH_API_URL', MY_QR_STUDENT_AUTH_SOURCE, 'API_URL'), {
    action: 'studentLogin',
    studentId: studentId,
    password: password
  });
  const verifiedId = String(result && result.profile && result.profile.studentId || '').trim();
  if (!result || !result.success || result.role !== 'STUDENT' || verifiedId !== studentId || !result.token) return null;
  return { studentId: verifiedId, token: String(result.token), expiresAt: String(result.expiresAt || '') };
}

function myQrValidateStudentSession_(session) {
  if (!session || !session.authToken) return false;
  const result = myQrPostJson_(myQrResolveApiUrl_('MY_QR_STUDENT_AUTH_API_URL', MY_QR_STUDENT_AUTH_SOURCE, 'API_URL'), {
    action: 'getSession',
    token: session.authToken
  });
  return !!result && result.success && result.role === 'STUDENT' && String(result.userId || '').trim() === session.studentId;
}

function myQrLogoutStudentSession_(session) {
  try {
    myQrPostJson_(myQrResolveApiUrl_('MY_QR_STUDENT_AUTH_API_URL', MY_QR_STUDENT_AUTH_SOURCE, 'API_URL'), {
      action: 'logout',
      token: session.authToken
    });
  } catch (error) {
    console.warn('upstream student logout failed');
  }
}

function requireQrStaffSession_(data) {
  const token = String(data.sessionToken || '').trim();
  const staffLoginId = String(data.staffLoginId || '').trim();
  if (!token || !staffLoginId) throw new Error('スタッフログインが必要です。');
  const response = UrlFetchApp.fetch(myQrResolveApiUrl_('MY_QR_STAFF_AUTH_API_URL', MY_QR_STAFF_AUTH_SOURCE, 'AUTH_API_URL'), {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify({ action: 'studentQrVerify', sessionToken: token }),
    muteHttpExceptions: true,
    followRedirects: true
  });
  let verified;
  try { verified = JSON.parse(response.getContentText()); } catch (error) { verified = null; }
  if (!verified || !verified.success ||
      String(verified.loginId || verified.code || '').trim() !== staffLoginId ||
      MY_QR_STAFF_PERMISSION_LEVELS.indexOf(String(verified.permissionLevel || '').trim()) < 0) {
    throw new Error('スタッフログインの有効期限が切れました。もう一度ログインしてください。');
  }
  return verified;
}

function myQrResolveApiUrl_(propertyName, sourceUrl, constantName) {
  const properties = PropertiesService.getScriptProperties();
  const configured = String(properties.getProperty(propertyName) || '').trim();
  if (configured) return configured;
  const cache = CacheService.getScriptCache();
  const cacheKey = 'MY_QR_ENDPOINT:' + propertyName;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const source = UrlFetchApp.fetch(sourceUrl, { muteHttpExceptions: true }).getContentText();
  const pattern = new RegExp('const\\s+' + constantName + '\\s*=\\s*[\\\'"]([^\\\'"]+)[\\\'"]');
  const match = source.match(pattern);
  if (!match) throw new Error('API接続設定を取得できません。');
  cache.put(cacheKey, match[1], MY_QR_SESSION_SECONDS);
  return match[1];
}

function myQrPostJson_(url, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true
  });
  try { return JSON.parse(response.getContentText()); } catch (error) { return null; }
}

function myQrHash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(function(byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function myQrSafeEquals_(expected, actual) {
  const a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(expected), Utilities.Charset.UTF_8);
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(actual), Utilities.Charset.UTF_8);
  let different = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) different |= a[i % a.length] ^ b[i % b.length];
  return different === 0;
}

function myQrPublicError_(message, code) {
  const error = new Error(message);
  error.publicMessage = message;
  error.publicCode = code;
  return error;
}
