import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "./auth";
import { decryptApiKey } from "./apiKeys";

const GITHUB_REPOS_PAGE_SIZE = 100;
const SEARCH_RESULT_LIMIT = 20;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

type CachedRepo = {
  id: number;
  name: string;
  fullName: string;
  ownerLogin: string;
  htmlUrl: string;
  description?: string;
  isPrivate: boolean;
};

type RepoCacheEntry = {
  tokenUpdatedAt: number;
  repos: CachedRepo[];
  seenRepoKeys: Set<string>;
  nextPage: number;
  isComplete: boolean;
  expiresAt: number;
  lastAccessedAt: number;
};

const repoCacheByUser = new Map<string, RepoCacheEntry>();

type GitHubRepoResponse = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  owner?: {
    login?: string | null;
  } | null;
};

function normalizePrefix(prefix: string): string {
  return prefix.trim().toLowerCase();
}

function pruneRepoCache(now: number) {
  for (const [userId, entry] of repoCacheByUser) {
    if (entry.expiresAt <= now) {
      repoCacheByUser.delete(userId);
    }
  }

  if (repoCacheByUser.size <= MAX_CACHE_ENTRIES) {
    return;
  }

  const oldestEntries = [...repoCacheByUser.entries()]
    .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)
    .slice(0, repoCacheByUser.size - MAX_CACHE_ENTRIES);
  for (const [userId] of oldestEntries) {
    repoCacheByUser.delete(userId);
  }
}

function getOrCreateCacheEntry(userId: string, tokenUpdatedAt: number, now: number): RepoCacheEntry {
  const existing = repoCacheByUser.get(userId);
  if (existing && existing.tokenUpdatedAt === tokenUpdatedAt && existing.expiresAt > now) {
    existing.lastAccessedAt = now;
    existing.expiresAt = now + CACHE_TTL_MS;
    return existing;
  }

  const freshEntry: RepoCacheEntry = {
    tokenUpdatedAt,
    repos: [],
    seenRepoKeys: new Set<string>(),
    nextPage: 1,
    isComplete: false,
    expiresAt: now + CACHE_TTL_MS,
    lastAccessedAt: now,
  };
  repoCacheByUser.set(userId, freshEntry);
  return freshEntry;
}

function appendRepos(entry: RepoCacheEntry, repos: GitHubRepoResponse[]) {
  for (const repo of repos) {
    const fullName = String(repo.full_name ?? "").trim();
    const name = String(repo.name ?? "").trim();
    const htmlUrl = String(repo.html_url ?? "").trim();
    if (!fullName || !name || !htmlUrl) {
      continue;
    }

    const dedupeKey = fullName.toLowerCase();
    if (entry.seenRepoKeys.has(dedupeKey)) {
      continue;
    }
    entry.seenRepoKeys.add(dedupeKey);

    entry.repos.push({
      id: repo.id,
      name,
      fullName,
      ownerLogin: String(repo.owner?.login ?? fullName.split("/")[0] ?? "").trim(),
      htmlUrl,
      description: repo.description ?? undefined,
      isPrivate: Boolean(repo.private),
    });
  }
}

function getPrefixMatches(repos: CachedRepo[], prefix: string): CachedRepo[] {
  if (!prefix) {
    return repos.slice(0, SEARCH_RESULT_LIMIT);
  }

  return repos
    .filter((repo) => {
      const fullName = repo.fullName.toLowerCase();
      const name = repo.name.toLowerCase();
      return fullName.startsWith(prefix) || name.startsWith(prefix);
    })
    .slice(0, SEARCH_RESULT_LIMIT);
}

async function fetchRepoPage(token: string, page: number): Promise<{
  status: "ok";
  repos: GitHubRepoResponse[];
} | {
  status: "error";
  message: string;
}> {
  const response = await fetch(
    `https://api.github.com/user/repos?per_page=${GITHUB_REPOS_PAGE_SIZE}&page=${page}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "tasky-repo-search",
      },
    }
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        status: "error",
        message: "GitHub rejected the saved token. Update it in Settings and try again.",
      };
    }
    return {
      status: "error",
      message: `GitHub repo lookup failed with status ${response.status}.`,
    };
  }

  const repos = (await response.json()) as GitHubRepoResponse[];
  if (!Array.isArray(repos)) {
    return {
      status: "error",
      message: "GitHub repo lookup returned an unexpected response.",
    };
  }

  return {
    status: "ok",
    repos,
  };
}

export const search = action({
  args: {
    prefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const now = Date.now();
    pruneRepoCache(now);

    const keyRow = await ctx.runQuery(internal.apiKeys.getLatestByTypeInternal, {
      userId,
      type: "github",
    });
    if (!keyRow) {
      return {
        status: "no_token" as const,
        message: "Add a GitHub token in Settings to search your repositories.",
        repos: [] as CachedRepo[],
        totalCachedRepos: 0,
        cacheComplete: false,
      };
    }

    const token = await decryptApiKey(keyRow.encryptedValue, keyRow.iv);
    if (!token.trim()) {
      return {
        status: "no_token" as const,
        message: "Add a GitHub token in Settings to search your repositories.",
        repos: [] as CachedRepo[],
        totalCachedRepos: 0,
        cacheComplete: false,
      };
    }

    const prefix = normalizePrefix(args.prefix ?? "");
    const cacheEntry = getOrCreateCacheEntry(userId, keyRow.updatedAt, now);

    while (true) {
      const currentMatches = getPrefixMatches(cacheEntry.repos, prefix);
      if (cacheEntry.isComplete || currentMatches.length >= SEARCH_RESULT_LIMIT) {
        return {
          status: "ok" as const,
          repos: currentMatches,
          totalCachedRepos: cacheEntry.repos.length,
          cacheComplete: cacheEntry.isComplete,
        };
      }

      const pageResult = await fetchRepoPage(token, cacheEntry.nextPage);
      if (pageResult.status === "error") {
        return {
          status: "github_error" as const,
          message: pageResult.message,
          repos: currentMatches,
          totalCachedRepos: cacheEntry.repos.length,
          cacheComplete: cacheEntry.isComplete,
        };
      }

      appendRepos(cacheEntry, pageResult.repos);
      cacheEntry.nextPage += 1;
      cacheEntry.lastAccessedAt = Date.now();
      cacheEntry.expiresAt = cacheEntry.lastAccessedAt + CACHE_TTL_MS;
      if (pageResult.repos.length < GITHUB_REPOS_PAGE_SIZE) {
        cacheEntry.isComplete = true;
      }
    }
  },
});
