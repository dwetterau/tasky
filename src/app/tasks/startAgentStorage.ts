"use client";

export function getLastSelectedRepoStorageKey(storageKeySuffix: string): string {
  return `tasky-last-selected-github-repo:${storageKeySuffix}`;
}

export function readStoredRepoSelection(storageKeySuffix: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  return localStorage.getItem(getLastSelectedRepoStorageKey(storageKeySuffix)) ?? "";
}
