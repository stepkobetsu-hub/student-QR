import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modern = fs.readFileSync(new URL('../tablet_checkin.html', import.meta.url), 'utf8');
const compat = fs.readFileSync(new URL('../tablet_checkin_compat.html', import.meta.url), 'utf8');

test('old Android automatically switches from the shared URL to compatibility mode', () => {
  assert.match(modern, /androidMajor > 0 && androidMajor < 9/);
  assert.match(modern, /missingModernApi/);
  assert.match(modern, /tablet_checkin_compat\.html.*location\.search.*location\.hash/);
});

test('compatibility page keeps the same campus configuration and Cloudflare API', () => {
  assert.match(compat, /stepCheckinEdgeConfigV1/);
  assert.match(compat, /stepCheckinEdgeDeviceIdV1/);
  assert.match(compat, /step-checkin-edge-staging\.stepkobetsu\.workers\.dev/);
  assert.match(compat, /\/v1\/checkins/);
  assert.match(compat, /Authorization/);
  assert.match(compat, /compatibilityMode: true/);
});

test('compatibility page avoids modern-only request APIs and limits camera work', () => {
  assert.doesNotMatch(compat, /\basync\b|\bawait\b|=>|\bconst\b|\blet\b|AbortController|URLSearchParams|\bfetch\s*\(/);
  assert.match(compat, /XMLHttpRequest/);
  assert.match(compat, /navigator\.webkitGetUserMedia/);
  assert.match(compat, /FRAME_INTERVAL = 200/);
  assert.match(compat, /480 \/ width/);
  assert.match(compat, /280 \/ width/);
});

test('all inline scripts are syntactically valid', () => {
  for (const page of [modern, compat]) {
    const scripts = [...page.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const script of scripts) new vm.Script(script[1]);
  }
});
