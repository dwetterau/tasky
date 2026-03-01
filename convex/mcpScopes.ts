import { Id } from "./_generated/dataModel";

export const TASKS_READ_SCOPE = "tasks:read";
export const TASKS_WRITE_SCOPE = "tasks:write";
export const TAG_ROOT_PREFIX = "tag:root=";

export type ParsedMcpScopes = {
  scopes: Set<string>;
  tagRootId?: Id<"tags">;
};

export function splitScopeString(scopeString: string): string[] {
  return scopeString
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

export function hasRequiredScope(parsed: ParsedMcpScopes, requiredScope: string): boolean {
  return parsed.scopes.has(requiredScope);
}
