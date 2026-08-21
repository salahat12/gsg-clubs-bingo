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
  ]),
  {
    // Tests and one-off scripts talk to jsonb RPC results and raw fetch
    // responses whose shape only the (already-tested) SQL functions
    // define. Typing every response inline would just re-describe the
    // RPCs in TypeScript for no safety benefit; `any` here is honest
    // about that boundary rather than a shortcut around app code.
    files: ["db/tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
