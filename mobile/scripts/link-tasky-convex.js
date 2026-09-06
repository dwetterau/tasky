#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const linkPath = path.resolve(projectRoot, "vendor/tasky-convex");
const sourceLinkRoot = path.resolve(projectRoot, "vendor/src");
const sourceLinkPath = path.resolve(
  sourceLinkRoot,
  "lib/githubPullRequestUrls.ts",
);

const sourceCandidates = [
  path.resolve(projectRoot, "../convex"),
  path.resolve(projectRoot, "../../tasky/convex"),
  path.resolve(projectRoot, "tasky-checkout/convex"),
];

const sourceRoot = sourceCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, "_generated/api.js")),
);

if (!sourceRoot) {
  console.warn(
    "Skipping tasky-convex link. Clone tasky beside dailies, then run npm run link-tasky-convex.",
  );
  process.exit(0);
}

fs.mkdirSync(path.dirname(linkPath), { recursive: true });

if (fs.existsSync(linkPath)) {
  fs.rmSync(linkPath, { recursive: true, force: true });
}

const relativeTarget = path.relative(path.dirname(linkPath), sourceRoot);
fs.symlinkSync(relativeTarget, linkPath, "dir");

const taskySourcePath = path.resolve(
  sourceRoot,
  "../src/lib/githubPullRequestUrls.ts",
);
if (fs.existsSync(sourceLinkRoot)) {
  fs.rmSync(sourceLinkRoot, { recursive: true, force: true });
}
if (fs.existsSync(taskySourcePath)) {
  fs.mkdirSync(path.dirname(sourceLinkPath), { recursive: true });
  const relativeSourceTarget = path.relative(
    path.dirname(sourceLinkPath),
    taskySourcePath,
  );
  fs.symlinkSync(relativeSourceTarget, sourceLinkPath, "file");
  console.log(`Linked ${sourceLinkPath} -> ${relativeSourceTarget}`);
}

console.log(`Linked ${linkPath} -> ${relativeTarget}`);
