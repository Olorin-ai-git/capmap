import { defineConfig, configDefaults } from "vitest/config";

/**
 * Coverage excludes are limited to process entry points and pure type
 * declarations. Everything with behaviour is measured.
 *
 * `bin.ts`, `server.ts` and `gate-hook.ts` are argument parsing and transport
 * wiring around functions that are themselves covered. All three ARE exercised
 * end to end — the hook suite drives the compiled binary with real payloads and
 * asserts its exit codes — but v8 cannot attribute coverage to a subprocess, so
 * leaving them in would credit them 0% while they are in fact tested. Excluding
 * them keeps the number honest in the other direction: what remains measured is
 * code whose tests really do execute it in-process.
 *
 * `composition.ts` resolves configuration paths and constructs adapters from
 * the environment. It is executed by every CLI end-to-end path and has no
 * branching logic worth pinning.
 *
 * `types.ts` declares interfaces only and emits no runtime code at all.
 */
const ENTRY_POINTS = [
  "packages/capmap-cli/src/bin.ts",
  "packages/capmap-mcp/src/server.ts",
  "hooks/src/gate-hook.ts",
  "packages/*/src/composition.ts",
  "packages/*/src/types.ts",
];

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "hooks/test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/test/fixtures/**"],
    /**
     * The suite creates around ninety temporary directories per run and used to
     * keep every one of them. Removing them centrally beats an `afterAll` in
     * each of a dozen files, one of which will always be the file someone
     * forgets.
     */
    globalSetup: ["test/global-teardown.ts"],
    /**
     * Well above the default 5s. Several suites parse every package in the
     * fixture estate with ts-morph, and v8 coverage instrumentation multiplies
     * that cost — without this the suite passes bare and fails under coverage,
     * which is the worst of both: green locally, red in CI, for no real defect.
     */
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "hooks/src/**/*.ts"],
      exclude: ["packages/*/src/**/index.ts", ...ENTRY_POINTS],
      thresholds: {
        lines: 87,
        functions: 87,
        branches: 87,
        statements: 87,
      },
    },
  },
});
