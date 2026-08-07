import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { TextEncoder } from 'node:util';

const html = fs.readFileSync(new URL('../my_qr.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean);
const source = scripts.at(-1);

function createStorage(seed = new Map()) {
  return {
    getItem: key => seed.has(key) ? seed.get(key) : null,
    setItem: (key, value) => seed.set(key, String(value)),
    removeItem: key => seed.delete(key),
    seed
  };
}

function createClient(sharedLocal = createStorage()) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id,
      value: '',
      textContent: '',
      className: '',
      childElementCount: 0,
      classList: { toggle() {} },
      addEventListener() {},
      replaceChildren() { this.childElementCount = 0; },
      appendChild() { this.childElementCount += 1; }
    });
    return elements.get(id);
  };
  const context = {
    console,
    Date,
    JSON,
    String,
    Number,
    Object,
    Promise,
    Array,
    Uint8Array,
    TextEncoder,
    crypto: crypto.webcrypto,
    performance: { mark() {}, measure() {} },
    localStorage: sharedLocal,
    sessionStorage: createStorage(),
    navigator: {},
    window: { STEP_MY_QR_API_URL: '__MY_QR_API_URL__', confirm: () => true },
    document: {
      getElementById: element,
      addEventListener() {},
      createElement: () => ({ className: '', textContent: '' })
    },
    fetch: async () => { throw new Error('not used'); },
    QRCode: function() {}
  };
  context.QRCode.CorrectLevel = { M: 0 };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('a restart reuses the saved QR without a session or server validation', () => {
  const local = createStorage();
  const first = createClient(local);
  first.saveQrCache({ studentId: '1320', name: 'A', registered: true, qrData: 'QR-A' });

  const restarted = createClient(local);
  assert.equal(restarted.readQrCache().qrData, 'QR-A');
  assert.equal(JSON.parse(local.getItem('stepMyQrDisplayCacheV5')).result.studentId, '1320');
});

test('logout clears both session tokens and the persistent QR cache before navigation', async () => {
  const local = createStorage();
  const client = createClient(local);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  client.saveSession('qr-token', expiresAt);
  client.saveCommonSession('common-token', expiresAt);
  client.saveQrCache({ studentId: '1320', registered: true, qrData: 'QR-A' });

  client.clearAllSessions();
  assert.equal(local.getItem('stepMyQrSessionToken'), null);
  assert.equal(local.getItem('stepCommonStudentSessionToken'), null);
  assert.equal(local.getItem('stepMyQrDisplayCacheV5'), null);
});
