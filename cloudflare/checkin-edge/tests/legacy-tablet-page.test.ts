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
