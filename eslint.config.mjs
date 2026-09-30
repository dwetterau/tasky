import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "convex/_generated/**",
    "mobile/**",
    "homepage/**",
  ]),
  {
    // Floating UI exposes callback refs through a `refs` object. The React
    // hooks rule mistakes those setters for render-time `.current` access.
    files: [
      "src/components/StyledSelect.tsx",
      "src/components/TagSelector.tsx",
    ],
    rules: {
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
