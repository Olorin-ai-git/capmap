import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Lint covers what the type checker and the source-constraint script cannot:
 * unused code, unsafe escapes from the type system, and promises left
 * unawaited. It deliberately does not enforce formatting — the repository has a
 * formatter and duplicating its opinions here only produces noise.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/test/fixtures/**",
      "index/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "error",
    },
  },
  {
    // Tests may assert on shapes the production types deliberately forbid, and
    // the installer is plain JavaScript that runs before any build exists —
    // it writes to stdout because that is its entire user interface.
    files: [
      "**/test/**/*.ts",
      "scripts/**/*.mjs",
      // The CLI launcher is plain JavaScript by design: it must run before any
      // build exists, so it is never compiled and writes to stderr directly.
      "packages/*/bin/*.mjs",
    ],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
);
