import { describe, expect, it } from "vitest";
import {
  checkinAuthorized,
  legacyTerminalCookieHeader,
  resolveCheckinCampus,
  terminalAuthorized,
  type TerminalTokenEnv,
} from "../src/index";

const env: TerminalTokenEnv = {
  TERMINAL_TOKEN: "common-token",
  TERMINAL_TOKEN_JINRYO: "jinryo-token",
  TERMINAL_TOKEN_OTEMACHI: "otemachi-token",
  INTEGRATION_TEST_TOKEN: "integration-token",
};

function terminalRequest(token: string): Request {
  return new Request("https://worker.test/v1/checkins", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("terminalAuthorized", () => {
  it("accepts an existing Jinryo terminal token for Otemachi", async () => {
    await expect(terminalAuthorized(terminalRequest("jinryo-token"), env, "otemachi")).resolves.toBe(true);
  });

  it("accepts an existing Otemachi terminal token for Jinryo", async () => {
    await expect(terminalAuthorized(terminalRequest("otemachi-token"), env, "jinryo")).resolves.toBe(true);
  });

  it("accepts the common token for either normal campus", async () => {
    await expect(terminalAuthorized(terminalRequest("common-token"), env, "jinryo")).resolves.toBe(true);
    await expect(terminalAuthorized(terminalRequest("common-token"), env, "otemachi")).resolves.toBe(true);
  });

  it("still rejects an unknown terminal token", async () => {
    await expect(terminalAuthorized(terminalRequest("unknown-token"), env, "jinryo")).resolves.toBe(false);
  });

  it("does not create access to an unknown campus", async () => {
    await expect(terminalAuthorized(terminalRequest("common-token"), env, "unknown-campus")).resolves.toBe(false);
  });

  it("keeps integration-test authentication isolated", async () => {
    await expect(terminalAuthorized(terminalRequest("integration-token"), env, "integration-test")).resolves.toBe(true);
    await expect(terminalAuthorized(terminalRequest("common-token"), env, "integration-test")).resolves.toBe(false);
  });
});

describe("resolveCheckinCampus", () => {
  it("uses one shared operational campus for both tablets", () => {
    expect(resolveCheckinCampus("jinryo")).toBe("jinryo");
    expect(resolveCheckinCampus("otemachi")).toBe("jinryo");
    expect(resolveCheckinCampus("古い校舎設定")).toBe("jinryo");
    expect(resolveCheckinCampus(undefined)).toBe("jinryo");
  });

  it("keeps the isolated integration test namespace", () => {
    expect(resolveCheckinCampus("integration-test")).toBe("integration-test");
  });
});

describe("legacy Worker-hosted tablet session", () => {
  const userAgent = "old-step-tablet/1.0";

  async function cookieRequest(requestUserAgent = userAgent): Promise<Request> {
    const launcherRequest = new Request("https://worker.test/legacy-tablet", {
      headers: { "User-Agent": requestUserAgent },
    });
    const setCookie = await legacyTerminalCookieHeader(launcherRequest, env);
    const cookie = String(setCookie).split(";")[0];
    return new Request("https://worker.test/v1/checkins", {
      headers: { Cookie: cookie, "User-Agent": requestUserAgent },
    });
  }

  it("issues a secure same-origin session cookie without exposing a terminal token", async () => {
    const request = new Request("https://worker.test/legacy-tablet", {
      headers: { "User-Agent": userAgent },
    });
    const header = await legacyTerminalCookieHeader(request, env);

    expect(header).toMatch(/^__Host-step_legacy_terminal=[A-Za-z0-9_-]+;/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(header).not.toContain("common-token");
  });

  it("authorizes a normal check-in with the Worker-issued cookie", async () => {
    await expect(checkinAuthorized(await cookieRequest(), env, "jinryo")).resolves.toBe(true);
    await expect(checkinAuthorized(await cookieRequest(), env, "otemachi")).resolves.toBe(true);
  });

  it("does not allow the legacy cookie into the integration test namespace", async () => {
    await expect(checkinAuthorized(await cookieRequest(), env, "integration-test")).resolves.toBe(false);
  });

  it("rejects a copied cookie when the tablet identity changes", async () => {
    const original = await cookieRequest();
    const copied = new Request(original.url, {
      headers: { Cookie: String(original.headers.get("Cookie")), "User-Agent": "another-device" },
    });
    await expect(checkinAuthorized(copied, env, "jinryo")).resolves.toBe(false);
  });
});
