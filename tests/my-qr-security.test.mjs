import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../my_qr.html', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../gas/MyQrApi.js', import.meta.url), 'utf8');
const gas = fs.readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../gas/README.md', import.meta.url), 'utf8');
const staffPage = fs.readFileSync(new URL('../student_qr_register.html', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../my_qr_runtime.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../my_qr_sw.js', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');

test('new public files contain no production identifiers or concrete authentication columns', () => {
  const publicChanges = [page, api, readme, runtime, serviceWorker, workflow].join('\n');
  assert.doesNotMatch(publicChanges, /script\.google\.com\/macros\/s\//);
  assert.doesNotMatch(publicChanges, /AKfy[a-zA-Z0-9_-]+/);
  assert.doesNotMatch(publicChanges, /docs\.google\.com\/spreadsheets\/d\//);
  assert.doesNotMatch(readme, /[A-Z]{1,2}列/);
});

test('client never saves a password and limits the persistent QR payload to display fields', () => {
  assert.match(page, /TOKEN_KEY = 'stepMyQrSessionToken'/);
  assert.match(page, /EXPIRES_KEY = 'stepMyQrSessionExpiresAt'/);
  assert.doesNotMatch(page, /localStorage\.setItem\([^\n]*password/i);
  assert.match(page, /const safeResult = \{ studentId: result\.studentId \|\| '', name: result\.name \|\| '', campus: result\.campus \|\| '', registered: !!result\.registered, qrData: result\.qrData \|\| '' \}/);
  assert.match(page, /\$\('password'\)\.value = ''/);
  assert.match(page, /\$\('studentId'\)\.value = ''/);
});

test('fast QR cache survives app restart until explicit logout and is revocable', () => {
  assert.match(page, /QR_CACHE_KEY = 'stepMyQrDisplayCacheV5'/);
  assert.match(page, /localStorage\.setItem\(QR_CACHE_KEY/);
  assert.doesNotMatch(page, /QR_CACHE_MAX_AGE_MS|cachedUntil|tokenFingerprint/);
  assert.match(page, /const cached = readQrCache\(\);[\s\S]*?if \(cached\) \{[\s\S]*?renderMyQr\(cached, true\);[\s\S]*?return;/);
  assert.match(page, /function clearSession\(\)[\s\S]*?clearQrCache\(\)/);
  assert.match(page, /catch \(error\) \{[\s\S]*?clearAllSessions\(\);[\s\S]*?clearQrVisual\(\);[\s\S]*?showPanel\('loginPanel'\)/);
});

test('startup has no resolver HTML fetch or CDN wait and service worker caches local QR assets', () => {
  assert.doesNotMatch(page, /fetch\('delivery_failures\.html'/);
  assert.doesNotMatch(page, /cdnjs|jsdelivr|api\.qrserver/);
  assert.match(page, /src="my_qr_runtime\.js"/);
  assert.match(page, /src="vendor\/qrcode\.min\.js"/);
  assert.match(page, /navigator\.serviceWorker\.register\('\.\/my_qr_sw\.js\?v=9'\)/);
  assert.match(serviceWorker, /'\.\/vendor\/qrcode\.min\.js'/);
  assert.match(serviceWorker, /'\.\/my_qr_runtime\.js'/);
  assert.doesNotMatch(page, /manifest-my-qr\.json/);
  assert.doesNotMatch(serviceWorker, /icon-qr-(?:192|512)\.png/);
  assert.match(workflow, /vars\.MY_QR_API_URL/);
});

test('cached startup renders once and exits before any API validation', () => {
  assert.match(page, /const mayReuse = reuseExisting/);
  assert.match(page, /else if \(!mayReuse\)/);
  assert.match(page, /renderMyQr\(cached, true\);[\s\S]*?return;[\s\S]*?const session = getPreferredSession\(\)/);
  assert.match(page, /performance\.measure/);
});

test('QR screen has safe logout and a prominent student-app return action', () => {
  assert.match(page, /id="logoutButton" class="top-logout hidden"/);
  assert.match(page, /window\.confirm\('ログアウトしますか？/);
  assert.match(page, /class="return-button"[^>]*>STEP塾生アプリに戻る</);
  assert.match(page, /\.return-button\{[^}]*background:linear-gradient\(135deg,var\(--blue\),var\(--sky\)\)/);
  assert.equal((page.match(/id="logoutButton"/g) || []).length, 1);
});

test('QR screen displays only the authenticated response student id', () => {
  assert.match(page, /id="studentIdDisplay"/);
  assert.match(page, /result\.studentId \? '生徒ID：' \+ result\.studentId/);
  assert.match(api, /studentId: record\.studentId/);
  assert.doesNotMatch(page, /studentIdDisplay'\)\.textContent[^\n]*\$\('studentId'\)/);
});

test('own-QR request sends a token only', () => {
  assert.match(page, /api\(\{ action: 'myQrGet', token: session\.token \}\)/);
  assert.doesNotMatch(page, /action: 'myQrGet'[^\n]*studentId/);
});

test('backend derives the student from the verified session', () => {
  assert.match(api, /const session = myQrRequireSession_\(body\.token\)/);
  assert.match(api, /myQrFindStudent_\(session\.studentId\)/);
  assert.match(api, /body\.studentId等は意図的に参照しない/);
});

test('backend exposes no arbitrary student lookup action', () => {
  assert.doesNotMatch(api, /function myQrGet_\(body,\s*studentId/);
  assert.match(gas, /requireQrStaffSession_\(params\)/);
  assert.match(gas, /isMyQrApiAction_\(action\)/);
});

test('staff QR page remains present and unchanged in purpose', () => {
  assert.match(staffPage, /QR_ALLOWED_PERMISSION_LEVELS = \['2', '3', '4'\]/);
  assert.match(staffPage, /既存QR登録/);
  assert.match(staffPage, /新規QR発行/);
});
