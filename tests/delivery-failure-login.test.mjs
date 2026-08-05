import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../delivery_failures.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';

test('delivery failure login remembers credentials and signs in automatically', () => {
  assert.match(html, /id="rememberLogin"[^>]*checked/);
  assert.match(html, /DELIVERY_LOGIN_KEY='deliveryFailuresSavedLogin'/);
  assert.match(html, /STAFF_PASSWORD_KEY='stepStaffAppPassword'/);
  assert.match(html, /localStorage\.getItem\(STAFF_PASSWORD_KEY\)/);
  assert.match(html, /localStorage\.setItem\(DELIVERY_LOGIN_KEY,JSON\.stringify\(\{code,password\}\)\)/);
  assert.match(html, /localStorage\.setItem\(STAFF_PASSWORD_KEY,password\)/);
  assert.match(html, /if\(code&&staffPassword\)\{loginDeliveryApp\(true\)\}/);
  assert.match(html, /event\.key==='Enter'/);
  assert.doesNotMatch(html, /安全のため、この管理画面ではパスワードを再入力してください/);
  assert.doesNotMatch(html, /id="loginCode"[^>]*readonly/);
});

test('delivery failure page script remains parseable', () => {
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
