const URL_PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const CURSOR_REVIEW_HOSTS = new Set(["review.cursor.com", "www.review.cursor.com"]);

export type ParsedGitHubPullRequestReference = {
  url: string;
  domain: string;
  owner: string;
  repo: string;
  number: number;
};

function ensureUrlProtocol(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  return URL_PROTOCOL_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function toCanonicalReference(owner: string, repo: string, number: number): ParsedGitHubPullRequestReference {
  return {
    url: `github.com/${owner}/${repo}/pull/${number}`,
    domain: "github.com",
    owner,
    repo,
    number,
  };
}

export function parseGitHubPullRequestReference(rawUrl: string): ParsedGitHubPullRequestReference {
  const parseInput = ensureUrlProtocol(rawUrl);

  let parsed: URL;
  try {
    parsed = new URL(parseInput);
  } catch {
    throw new Error("Invalid pull request URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);

  let ownerPart: string | undefined;
  let repoPart: string | undefined;
  let numberPart: string | undefined;

  if (GITHUB_HOSTS.has(hostname)) {
    if (parts.length < 4 || parts[2].toLowerCase() !== "pull") {
      throw new Error(
        "URL must match github.com/<owner>/<repo>/pull/<number> or review.cursor.com/github/pr/<owner>/<repo>/<number>"
      );
    }
    ownerPart = parts[0];
    repoPart = parts[1];
    numberPart = parts[3];
  } else if (CURSOR_REVIEW_HOSTS.has(hostname)) {
    if (parts.length < 5 || parts[0].toLowerCase() !== "github" || parts[1].toLowerCase() !== "pr") {
      throw new Error(
        "URL must match github.com/<owner>/<repo>/pull/<number> or review.cursor.com/github/pr/<owner>/<repo>/<number>"
      );
    }
    ownerPart = parts[2];
    repoPart = parts[3];
    numberPart = parts[4];
  } else {
    throw new Error(
      "Only github.com pull request URLs and review.cursor.com/github/pr links are supported"
    );
  }

  const owner = ownerPart?.toLowerCase() ?? "";
  const repo = repoPart?.toLowerCase() ?? "";
  const number = Number(numberPart);
  if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
    throw new Error("Invalid pull request URL");
  }

  return toCanonicalReference(owner, repo, number);
}

export function tryParseGitHubPullRequestReference(
  rawUrl: string
): ParsedGitHubPullRequestReference | null {
  try {
    return parseGitHubPullRequestReference(rawUrl);
  } catch {
    return null;
  }
}

export function normalizeGitHubPullRequestInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  return tryParseGitHubPullRequestReference(trimmed)?.url ?? ensureUrlProtocol(trimmed);
}

export function looksLikeGitHubPullRequestInput(input: string): boolean {
  return tryParseGitHubPullRequestReference(input) !== null;
}

export function getGitHubPullRequestHref(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  const parsed = tryParseGitHubPullRequestReference(trimmed);
  return parsed ? `https://${parsed.url}` : ensureUrlProtocol(trimmed);
}
