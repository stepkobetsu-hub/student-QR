import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../gas/MyQrApi.js', import.meta.url), 'utf8');

function createApi() {
  const rows = [
    [],
    ['A001','','','','生徒A','','','神領校',...Array(43).fill(''),'QR-A'],
    ['B002','','','','生徒B','','','大手町校',...Array(43).fill(''),'QR-B']
  ];
  const cache = new Map();
  let uuid = 0;
  const scriptCache = {
    get: key => cache.get(key) || null,
    put: (key, value) => cache.set(key, value),
    remove: key => cache.delete(key)
  };
  const sheet = {
    getLastRow: () => rows.length,
    getRange(row, col, count, width) {
      return {
        createTextFinder(value) {
          let matchEntire = false;
          return {
            matchEntireCell(value) { matchEntire = value; return this; },
            findNext() {
              const index = rows.findIndex((record, i) => i > 0 && (matchEntire ? String(record[col - 1]) === String(value) : String(record[col - 1]).includes(String(value))));
              return index < 0 ? null : { getRow: () => index };
            }
          };
        },
        getValues: () => [rows[row].slice(col - 1, col - 1 + width)]
      };
    }
  };
  const context = {
    console,
    Date,
    JSON,
    String,
    Number,
    Math,
    Error,
    CacheService: { getScriptCache: () => scriptCache },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => [...crypto.createHash('sha256').update(String(value), 'utf8').digest()]
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: value => ({ setMimeType: () => value }) }
  };
  Object.assign(context, {
    getMasterSheet_: () => sheet,
    COL_STUDENT_ID: 1,
    COL_STUDENT_NAME: 5,
    COL_SCHOOL: 8,
    COL_QR_DATA: 52
  });
  vm.createContext(context);
  vm.runInContext(source, context);
  const credentials = new Map([['A001:passA', 'A001'], ['B002:passB', 'B002']]);
  context.myQrAuthenticateStudent_ = (studentId, password) => {
    const verifiedId = credentials.get(`${studentId}:${password}`);
    return verifiedId ? { studentId: verifiedId, token: `upstream-${verifiedId}` } : null;
  };
  context.myQrValidateStudentSession_ = session => session.authToken === `upstream-${session.studentId}`;
  context.myQrLogoutStudentSession_ = () => {};
  context.myQrResolveApiUrl_ = () => 'private-configured-endpoint';
  context.myQrPostJson_ = (_url, payload) => payload.action === 'getCommonStudentSession' && payload.token === 'common-A'
    ? { success: true, role: 'STUDENT', profile: { studentId: 'A001' } }
    : { success: false };
  return { context, cache };
}

test('direct login response already contains the authenticated student QR', () => {
  const { context } = createApi();
  const login = context.myQrLogin_({ studentId: 'A001', password: 'passA' });
  assert.equal(login.qrData, 'QR-A');
  assert.notEqual(login.qrData, 'QR-B');
});

test('common student A token directly returns only student A QR', () => {
  const { context } = createApi();
  const result = context.myQrCommonGet_({ commonToken: 'common-A', studentId: 'B002' });
  assert.equal(result.studentId, 'A001');
  assert.equal(result.qrData, 'QR-A');
  assert.notEqual(result.qrData, 'QR-B');
});

test('student A token never returns student B QR even if B id is supplied', () => {
  const { context } = createApi();
  const login = context.myQrLogin_({ studentId: 'A001', password: 'passA' });
  const result = context.myQrGet_({ token: login.token, studentId: 'B002' });
  assert.equal(result.name, '生徒A');
  assert.equal(result.qrData, 'QR-A');
  assert.notEqual(result.qrData, 'QR-B');
});

test('tampered token is rejected', () => {
  const { context } = createApi();
  const login = context.myQrLogin_({ studentId: 'A001', password: 'passA' });
  assert.throws(() => context.myQrGet_({ token: login.token + 'tampered' }), error => error.publicCode === 'SESSION_EXPIRED');
});

test('logout revokes token immediately', () => {
  const { context } = createApi();
  const login = context.myQrLogin_({ studentId: 'A001', password: 'passA' });
  context.myQrLogout_({ token: login.token });
  assert.throws(() => context.myQrGet_({ token: login.token }), error => error.publicCode === 'SESSION_EXPIRED');
});

test('expired token is rejected', () => {
  const { context, cache } = createApi();
  const login = context.myQrLogin_({ studentId: 'B002', password: 'passB' });
  const key = 'MY_QR_SESSION_V1:' + context.myQrHash_(login.token);
  cache.set(key, JSON.stringify({ studentId: 'B002', expiresAt: '2000-01-01T00:00:00.000Z', authToken: 'upstream-B002' }));
  assert.throws(() => context.myQrGet_({ token: login.token }), error => error.publicCode === 'SESSION_EXPIRED');
});
