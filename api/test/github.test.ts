import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDashboardFileSha } from "../src/lib/github";

/**
 * These tests exist because of a specific bug that was live in this repo.
 *
 * getDashboardFileSha's predecessor also base64-decoded and JSON.parse'd the
 * file `content` it never actually used. GitHub's Contents API returns
 * `content: ""` / `encoding: "none"` for any file over 1 MB (above that size
 * only the raw/object media types carry content), so once dashboard.json
 * crossed 1 MB, JSON.parse("") threw. The caller swallowed that and fell back
 * to committing with no sha, which GitHub rejects with 422 on an existing
 * path — so every push would have failed permanently, with the SHA-based
 * optimistic-concurrency guarantee silently void.
 *
 * The "1 MB" case below is the real regression guard: it must keep passing
 * even though it looks redundant next to the small-file case.
 */

const ORIGINAL_ENV = { ...process.env };

function mockGitHubResponse(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.GITHUB_OWNER = "olioautoprotectgroup";
  process.env.GITHUB_REPO = "underwriting_review_webapp";
  process.env.GITHUB_TOKEN = "github_pat_exampletoken";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("getDashboardFileSha", () => {
  it("returns the sha for a small file (content present)", async () => {
    const content = Buffer.from(JSON.stringify({ dealers: [] }), "utf-8").toString("base64");
    vi.stubGlobal("fetch", mockGitHubResponse({ sha: "abc123", content, encoding: "base64" }));

    await expect(getDashboardFileSha()).resolves.toBe("abc123");
  });

  it("returns the sha for a file over 1 MB, where GitHub omits the content", async () => {
    // Exactly what the Contents API sends above 1 MB.
    vi.stubGlobal("fetch", mockGitHubResponse({ sha: "def456", content: "", encoding: "none" }));

    await expect(getDashboardFileSha()).resolves.toBe("def456");
  });

  it("does not depend on content being valid JSON at all", async () => {
    vi.stubGlobal("fetch", mockGitHubResponse({ sha: "ghi789", content: "%%%not-base64-json%%%" }));

    await expect(getDashboardFileSha()).resolves.toBe("ghi789");
  });

  it("throws when GitHub returns no sha, rather than returning undefined", async () => {
    vi.stubGlobal("fetch", mockGitHubResponse({ content: "" }));

    await expect(getDashboardFileSha()).rejects.toThrow(/no sha/i);
  });

  it("surfaces a GitHub API error instead of swallowing it", async () => {
    vi.stubGlobal("fetch", mockGitHubResponse({ message: "Not Found" }, false, 404));

    await expect(getDashboardFileSha()).rejects.toThrow(/GitHub API 404/);
  });

  it("fails clearly when a required app setting is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    vi.stubGlobal("fetch", mockGitHubResponse({ sha: "abc123", content: "" }));

    await expect(getDashboardFileSha()).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it("rejects a token containing smart-punctuation from a copy-paste", async () => {
    process.env.GITHUB_TOKEN = "github_pat_’example";
    vi.stubGlobal("fetch", mockGitHubResponse({ sha: "abc123", content: "" }));

    await expect(getDashboardFileSha()).rejects.toThrow(/non-standard character/);
  });
});
