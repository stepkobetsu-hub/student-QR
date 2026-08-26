import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("legacy tablet launcher", () => {
  it("serves the compatibility reader directly from the Worker origin", async () => {
    const response = await SELF.fetch("https://worker.test/legacy-tablet");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("古いタブレット用・軽量モード");
    expect(html).toContain('rel="icon" type="image/png" sizes="192x192"');
    expect(html).toContain('rel="apple-touch-icon" sizes="192x192"');
    expect(html).toContain('rel="manifest" href="/legacy-tablet-manifest.json"');
    expect(html).toContain('rel="preconnect" href="https://step-checkin-edge-staging.stepkobetsu.workers.dev"');
    expect(html).toContain("https://stepkobetsu-hub.github.io/student-QR/icon-192.png?v=20260826");
    expect(html).toContain('<script src="/legacy-jsqr.js"></script>');
    expect(html).toContain("/v1/checkins");
    expect(html).toContain("width:30%;height:38%");
    expect(html).toContain("displayProcessing()");
    expect(html).toContain("warmEdgeConnection()");
    expect(html).toContain("setInterval(warmEdgeConnection, 30000)");
    expect(html).toContain("INACTIVITY_TIMEOUT = 5 * 60 * 60 * 1000");
    expect(html).toContain('id="idleOverlay"');
    expect(html).toContain("画面をタップすると再開します");
    expect(html).toContain("function enterRestMode()");
    expect(html).toContain("function stopCameraStream()");
    expect(html).toContain("window.SleepControl.setSleeping(isSleeping)");
    expect(html).toContain("idleOverlay.addEventListener('click', resumeFromRest");
    expect(html).toContain("result.className = ''");
    expect(html).toContain("message.innerHTML = '受付中です…'");
    expect(html).not.toContain("nameEl.innerHTML = 'QRを読み取りました'");
    expect(html).not.toContain("typeEl.innerHTML = '受付中'");
    expect(html).toContain("teacher-arrival.png");
    expect(html).toContain("teacher-goodbye.png");
    expect(html).toContain("teacher-duplicate.png");
    expect(html).toContain("welcome.png");
    expect(html).toContain("goodbye.png");
    expect(html).toContain("goodbye-director-night-fast.webp?v=20260807");
    expect(html).toContain("goodbye-rare-woman.webp?v=20260819");
    expect(html).toContain("PHOTO_EXIT_PROBABILITY = 0.10");
    expect(html).toContain("RARE_EXIT_PROBABILITY = 0.05");
    expect(html).toContain("MASCOT_EXIT_PROBABILITY = 0.05");
    expect(html).toContain("20秒以内の重複読取");
    expect(html).toContain("入室済みです");
    expect(html).toContain("退室済みです");
    expect(html).toContain("duplicate-exit");
    expect(html).toContain("font-size:72px");
    expect(html).toContain("font-size:68px");
    expect(html).toContain("background:#165e83");
    expect(html).toContain("useRareExitVariant = !duplicate && !isTeacher && type === '退室'");
    expect(html).toContain("usePhotoExitVariant = !duplicate && !isTeacher && type === '退室'");
    expect(html).toContain("useRareExitVariant ? RARE_EXIT_ASSET");
    expect(html).toContain("usePhotoExitVariant ? PHOTO_EXIT_ASSET");
    expect(html).toContain("resultCharacter.onerror = function ()");
    expect(html).toContain("exitPhotoPreload.src = ASSET_BASE + PHOTO_EXIT_ASSET");
    expect(html).toContain("rareExitPreload.src = ASSET_BASE + RARE_EXIT_ASSET");
    expect(html).toContain("duplicate.png");
    expect(html).toContain("resultCharacter.removeAttribute('src')");
    expect(html).toContain("return { campus: 'jinryo'");
    expect(html).toContain("return { campus: 'jinryo', token: '', apiUrl: API_DEFAULT }");
    expect(html).toContain("if (config.token) xhr.setRequestHeader('Authorization'");
    expect(html).not.toContain("if (!config)");
    expect(html).not.toContain("/^(jinryo|otemachi)$/.test(value.campus)");
    expect(html).not.toContain("この端末の校舎設定");
  });

  it("serves a home-screen manifest with the existing green camera icon", async () => {
    const response = await SELF.fetch("https://worker.test/legacy-tablet-manifest.json");
    const manifest = await response.json<{
      name: string;
      short_name: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    }>();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/manifest+json");
    expect(manifest.name).toBe("出退くん");
    expect(manifest.short_name).toBe("出退くん");
    expect(manifest.start_url).toBe("/legacy-tablet");
    expect(manifest.icons).toEqual([
      expect.objectContaining({
        src: "https://stepkobetsu-hub.github.io/student-QR/icon-192.png?v=20260826",
        sizes: "192x192",
        purpose: "any maskable",
      }),
      expect.objectContaining({
        src: "https://stepkobetsu-hub.github.io/student-QR/icon-512.png?v=20260826",
        sizes: "512x512",
        purpose: "any maskable",
      }),
    ]);
  });

  it("serves the bundled ES5 QR reader from the same Worker origin", async () => {
    const response = await SELF.fetch("https://worker.test/legacy-jsqr.js");
    const script = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/javascript");
    expect(script).toContain("webpackUniversalModuleDefinition");
    expect(script.length).toBeGreaterThan(200_000);
  });
});
