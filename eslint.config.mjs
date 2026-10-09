import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["out/**", "node_modules/**", "test-fixtures/**", "sample-workspace/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  // ANSI escape stripping intentionally matches the ESC control character.
  { rules: { "no-control-regex": "off" } }
);
