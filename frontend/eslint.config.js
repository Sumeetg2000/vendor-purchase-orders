import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactRefresh.configs.vite,
  prettierConfig,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    // Only the two long-standing react-hooks rules — the plugin's
    // "recommended"/"recommended-latest" configs pull in a much larger,
    // React-Compiler-oriented rule set (e.g. set-state-in-effect) that
    // flags the ordinary fetch-on-mount useEffect pattern used throughout
    // this app; this project doesn't use the React Compiler.
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
);
