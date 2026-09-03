import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HttpRequest } from "@azure/functions";
import {
  forbiddenResponse,
  getClientPrincipal,
  isAuthorizedStaff,
  isAuthorizedWriteback,
} from "../src/lib/auth";

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

describe("forbiddenResponse", () => {
  // This exists because an opaque 403 hid a real bug: a user whose address was
  // on the allowlist was refused by the API while the client-side copy of the
  // same list accepted them, so they saw the full app shell with an
  // unexplained error inside it. Nothing on either side reported which
  // identity had been rejected. These tests pin the behaviour that makes such
  // a disagreement visible.
  it("names the identity the server actually saw", () => {
    const res = forbiddenResponse(requestWithPrincipal("someone@example.com"));
    expect(res.status).toBe(403);
    expect(res.jsonBody.signedInAs).toBe("someone@example.com");
  });

  it("reports the identity verbatim, without lowercasing it", () => {
    // The allowlist comparison lowercases, but this is a diagnostic: it must
    // show the exact string so a case- or character-level mismatch (an "I"
    // read as an "l", say) is visible rather than normalised away.
    const res = forbiddenResponse(requestWithPrincipal("cIngrey@Autoprotect.net"));
    expect(res.jsonBody.signedInAs).toBe("cIngrey@Autoprotect.net");
  });

  it("reports null when the client-principal header never arrived", () => {
    // A different fault from an unrecognised address, and the distinction is
    // the whole point: null means SWA did not attach the header at all.
    const res = forbiddenResponse(requestWithPrincipal(undefined));
    expect(res.jsonBody.signedInAs).toBeNull();
  });

  it("reports null when the header is present but unparseable", () => {
    const res = forbiddenResponse(requestWithHeader("x-ms-client-principal", "not-base64-json"));
    expect(res.jsonBody.signedInAs).toBeNull();
  });

  it("carries ONLY error and signedInAs, never the rest of the principal", () => {
    // Guards against this growing into a principal dump. userId and userRoles
    // are in the header and must not be echoed — the caller's own email is
    // information they already have, their object id is not something this
    // endpoint has any reason to hand back.
    const res = forbiddenResponse(requestWithPrincipal("someone@example.com"));
    expect(Object.keys(res.jsonBody).sort()).toEqual(["error", "signedInAs"]);
    expect(JSON.stringify(res.jsonBody)).not.toContain("u1");
    expect(JSON.stringify(res.jsonBody)).not.toContain("authenticated");
  });

  it("keeps the same error text every staff route returned before", () => {
    const res = forbiddenResponse(requestWithPrincipal("someone@example.com"));
    expect(res.jsonBody.error).toBe("Access restricted to approved underwriting staff");
  });
});
