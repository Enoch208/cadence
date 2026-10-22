import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  reactHooks.configs.flat["recommended-latest"],
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "no-console": "error",
    },
  },
  {
    files: ["**/*.js", "**/*.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
