import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "generator/**",
      "model-data/**",
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // Meteogramm-Kern: framework-frei (REQ-415).
    files: ["packages/meteogram/src/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-*", "react/*"], message: "Der Kern bleibt framework-frei." },
          ],
        },
      ],
    },
  },
  {
    // React-Hülle und Website: Regeln für Hooks (REQ-093, REQ-428).
    files: ["packages/meteogram-react/**/*.{ts,tsx}", "apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
