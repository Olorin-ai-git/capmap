#!/usr/bin/env node
/**
 * Committed launcher, deliberately not a build output.
 *
 * pnpm creates a bin link only when the target file exists at install time, and
 * a clean checkout installs before it builds — so pointing `bin` straight at
 * `dist/bin.js` meant `capmap` simply did not exist after `pnpm install`,
 * although every document and both skills invoke it. This file always exists,
 * so the link is always created, and it says plainly what to do when the build
 * has not run yet.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "dist", "bin.js");

if (!existsSync(entry)) {
  process.stderr.write(
    'capmap has not been built yet. Run "pnpm -r build" from the ' +
      "capability-map repository root.\n",
  );
  process.exit(1);
}

await import(entry);
