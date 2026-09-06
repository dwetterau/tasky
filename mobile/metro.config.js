const { getDefaultConfig } = require("expo/metro-config");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const taskyConvexRoot = path.resolve(projectRoot, "vendor/tasky-convex");

if (!fs.existsSync(path.join(taskyConvexRoot, "_generated/api.js"))) {
  throw new Error(
    "Missing tasky-convex bindings. Run: npm run link-tasky-convex",
  );
}

const config = getDefaultConfig(projectRoot);

config.watchFolders = [taskyConvexRoot];

config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    "tasky-convex": taskyConvexRoot,
  },
  nodeModulesPaths: [path.resolve(projectRoot, "node_modules")],
};

module.exports = config;
