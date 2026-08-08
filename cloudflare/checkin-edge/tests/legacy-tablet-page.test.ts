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
    expect(html).toContain('<script src="/legacy-jsqr.js"></script>');
    expect(html).toContain("/v1/checkins");
    expect(html).toContain("width:30%;height:38%");
    expect(html).toContain("displayProcessing()");
    expect(html).toContain("result.className = ''");
    expect(html).not.toContain("typeEl.innerHTML = '受付中'");
    expect(html).toContain("teacher-arrival.png");
    expect(html).toContain("teacher-goodbye.png");
    expect(html).toContain("teacher-duplicate.png");
    expect(html).toContain("welcome.png");
    expect(html).toContain("goodbye.png");
    expect(html).toContain("duplicate.png");
    expect(html).toContain("resultCharacter.removeAttribute('src')");
    expect(html).toContain("return { campus: 'jinryo'");
    expect(html).toContain("return { campus: 'jinryo', token: '', apiUrl: API_DEFAULT }");
    expect(html).toContain("if (config.token) xhr.setRequestHeader('Authorization'");
    expect(html).not.toContain("if (!config)");
    expect(html).not.toContain("/^(jinryo|otemachi)$/.test(value.campus)");
    expect(html).not.toContain("この端末の校舎設定");
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
