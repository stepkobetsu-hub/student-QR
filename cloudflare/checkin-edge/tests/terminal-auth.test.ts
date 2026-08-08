import { describe, expect, it } from "vitest";
import { terminalAuthorized, type TerminalTokenEnv } from "../src/index";

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
