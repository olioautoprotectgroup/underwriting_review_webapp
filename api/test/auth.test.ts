import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HttpRequest } from "@azure/functions";
import { getClientPrincipal, isAuthorizedStaff, isAuthorizedWriteback } from "../src/lib/auth";

function requestWithPrincipal(userDetails: string | undefined): HttpRequest {
  const headers: Record<string, string> = {};
  if (userDetails !== undefined) {
    const principal = { identityProvider: "aad", userId: "u1", userDetails, userRoles: ["authenticated"] };
    headers["x-ms-client-principal"] = Buffer.from(JSON.stringify(principal), "utf-8").toString("base64");
  }
  return new HttpRequest({ method: "GET", url: "https://example.com/api/dashboard", headers });
}

function requestWithHeader(name: string, value: string | undefined): HttpRequest {
  const headers: Record<string, string> = {};
  if (value !== undefined) headers[name] = value;
  return new HttpRequest({ method: "PUT", url: "https://example.com/api/dashboard-data", headers });
}

describe("getClientPrincipal", () => {
  it("returns null when the header is missing", () => {
    expect(getClientPrincipal(requestWithPrincipal(undefined))).toBeNull();
  });

  it("returns null when the header is not valid base64/JSON", () => {
    const req = new HttpRequest({
      method: "GET",
      url: "https://example.com/",
      headers: { "x-ms-client-principal": "not-valid-base64-json!!!" },
    });
    // Malformed base64 still decodes to *something*; it's the JSON.parse that should fail.
    expect(getClientPrincipal(req)).toBeNull();
  });

  it("decodes a well-formed principal", () => {
    const principal = getClientPrincipal(requestWithPrincipal("jane@autoprotectgroup.co.uk"));
    expect(principal?.userDetails).toBe("jane@autoprotectgroup.co.uk");
  });
});

describe("isAuthorizedStaff", () => {
  it("rejects a request with no principal", () => {
    expect(isAuthorizedStaff(requestWithPrincipal(undefined))).toBe(false);
  });

  it("rejects an email not on the allowlist", () => {
    expect(isAuthorizedStaff(requestWithPrincipal("not-on-list@autoprotectgroup.co.uk"))).toBe(false);
  });

  it("accepts an allowlisted @autoprotectgroup.co.uk email", () => {
    expect(isAuthorizedStaff(requestWithPrincipal("oliver.oakes@autoprotectgroup.co.uk"))).toBe(true);
  });

  it("accepts an allowlisted @autoprotect.net email (the list spans two domains)", () => {
    expect(isAuthorizedStaff(requestWithPrincipal("cingrey@autoprotect.net"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAuthorizedStaff(requestWithPrincipal("Oliver.Oakes@AutoProtectGroup.co.uk"))).toBe(true);
  });

  it("rejects a similarly-named but wrong domain (proves this is exact-match, not a suffix check)", () => {
    expect(isAuthorizedStaff(requestWithPrincipal("oliver.oakes@evilautoprotectgroup.co.uk"))).toBe(false);
  });
});

describe("isAuthorizedWriteback", () => {
  const ORIGINAL_KEY = process.env.DATABRICKS_WRITEBACK_KEY;

  beforeEach(() => {
    process.env.DATABRICKS_WRITEBACK_KEY = "correct-horse-battery-staple";
  });

  afterEach(() => {
    process.env.DATABRICKS_WRITEBACK_KEY = ORIGINAL_KEY;
  });

  it("rejects when no app setting is configured", () => {
    delete process.env.DATABRICKS_WRITEBACK_KEY;
    expect(isAuthorizedWriteback(requestWithHeader("x-writeback-key", "anything"))).toBe(false);
  });

  it("rejects when the header is missing", () => {
    expect(isAuthorizedWriteback(requestWithHeader("x-writeback-key", undefined))).toBe(false);
  });

  it("rejects a wrong-length key", () => {
    expect(isAuthorizedWriteback(requestWithHeader("x-writeback-key", "short"))).toBe(false);
  });

  it("rejects a same-length but wrong key", () => {
    const wrong = "x".repeat("correct-horse-battery-staple".length);
    expect(isAuthorizedWriteback(requestWithHeader("x-writeback-key", wrong))).toBe(false);
  });

  it("accepts the correct key", () => {
    expect(isAuthorizedWriteback(requestWithHeader("x-writeback-key", "correct-horse-battery-staple"))).toBe(true);
  });
});
