/**
 * Persists the periodic Databricks dashboard push by committing the updated
 * data/dashboard.json straight back to this repo via the GitHub Contents
 * API. This keeps the read-side datastore at zero additional infrastructure
 * cost (no database) — the tradeoff is a short redeploy delay (roughly a
 * minute, via the existing CI/CD) before a refresh is live, since Azure
 * Functions' local disk isn't guaranteed to persist writes across
 * restarts/scale-out.
 *
 * Case data never goes through this path — see the frontend development
 * plan's "Case write path" section for why cases are read/written live
 * against Databricks instead (see databricks.ts).
 *
 * Required app settings: GITHUB_TOKEN (a fine-grained PAT scoped to this
 * repo's Contents: Read and write permission), GITHUB_OWNER, GITHUB_REPO.
 * Optional: GITHUB_BRANCH (defaults to "main"), GITHUB_DATA_PATH (defaults
 * to "api/data/dashboard.json").
 */
const GITHUB_API = "https://api.github.com";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required app setting: ${name}`);
  return value;
}

/**
 * Like requiredEnv, but for values that end up in an HTTP header (which must
 * be plain ASCII/Latin1). Copy-pasting a token through an app with
 * autocorrect/"smart" punctuation (Word, Notes, etc.) can silently swap in a
 * curly quote or an arrow — the raw fetch() error for that ("character ...
 * has a value ... greater than 255") gives no hint it's an app setting
 * problem, so check explicitly and say so.
 */
function requiredHeaderSafeEnv(name: string): string {
  const value = requiredEnv(name).trim();
  const badChar = [...value].find((c) => (c.codePointAt(0) ?? 0) > 255);
  if (badChar) {
    throw new Error(
      `App setting ${name} contains a non-standard character (U+${(badChar.codePointAt(0) ?? 0)
        .toString(16)
        .toUpperCase()}) — it was likely copy-pasted through something with autocorrect/` +
        `"smart" punctuation enabled. Re-copy it directly from GitHub and re-save the app setting.`,
    );
  }
  return value;
}

function repoConfig() {
  return {
    owner: requiredEnv("GITHUB_OWNER"),
    repo: requiredEnv("GITHUB_REPO"),
    branch: process.env.GITHUB_BRANCH || "main",
    path: process.env.GITHUB_DATA_PATH || "api/data/dashboard.json",
    token: requiredHeaderSafeEnv("GITHUB_TOKEN"),
  };
}

function describeTokenShape(token: string): string {
  const prefix = token.match(/^[a-z]+_/)?.[0];
  const kind =
    prefix === "ghp_"
      ? "classic PAT"
      : prefix === "github_pat_"
        ? "fine-grained PAT"
        : prefix
          ? `unrecognised prefix "${prefix}"`
          : "no recognised prefix (old-style 40-char token?)";
  return `${kind}, length ${token.length}`;
}

async function githubRequest(url: string, token: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} (using ${describeTokenShape(token)}): ${body}`);
  }
  return res.json();
}

/**
 * Fetches the dashboard snapshot straight from GitHub, along with the
 * blob's current sha. Every write must build on this rather than the local
 * file (which only reflects whatever was deployed last) — otherwise two
 * writeback calls close together would each silently overwrite the other's
 * change, even though each individual git commit succeeds.
 */
export async function getCurrentDashboardJson<T>(): Promise<{ data: T; sha: string }> {
  const { owner, repo, branch, path, token } = repoConfig();
  const contentsUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const file = (await githubRequest(contentsUrl, token)) as { sha: string; content: string };
  const decoded = Buffer.from(file.content, "base64").toString("utf-8");
  return { data: JSON.parse(decoded) as T, sha: file.sha };
}

/**
 * Commits the given JSON content to the dashboard data file, replacing it
 * entirely. `expectedSha` must be the sha from the getCurrentDashboardJson()
 * call this write was based on — GitHub rejects the commit with a 409 if the
 * file has moved on since (a concurrent writeback), which surfaces as a
 * clear "please retry" error instead of silently discarding either write.
 */
export async function commitDashboardJson(
  content: unknown,
  expectedSha: string,
  commitMessage: string,
): Promise<void> {
  const { owner, repo, branch, path, token } = repoConfig();
  const body = JSON.stringify(content, null, 2) + "\n";
  const encoded = Buffer.from(body, "utf-8").toString("base64");

  await githubRequest(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, token, {
    method: "PUT",
    body: JSON.stringify({
      message: commitMessage,
      content: encoded,
      sha: expectedSha,
      branch,
    }),
  });
}
