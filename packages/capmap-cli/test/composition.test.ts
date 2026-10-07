import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDeps } from "../src/composition.js";
import { repoRoot } from "./support/paths.js";

/**
 * "Keep the real index outside the public repository": an index describes the
 * estate it was built from, so one built from repositories outside this
 * checkout must never land in the tracked `index/` directory, where the next
 * commit would publish it.
 */
describe("buildDeps index placement", () => {
  const checkoutConfig = join(repoRoot(), "config");

  it("refuses an index inside this checkout for an estate outside it", async () => {
    const estate = await mkdtemp(join(tmpdir(), "capmap-real-estate-"));
    await expect(
      buildDeps({ CAPMAP_CONFIG_DIR: checkoutConfig, CAPMAP_ROOT: estate }),
    ).rejects.toThrow(/outside this checkout/);
  });

  it("accepts the committed example estate with its committed index", async () => {
    const deps = await buildDeps({
      CAPMAP_CONFIG_DIR: checkoutConfig,
      CAPMAP_ROOT: join(repoRoot(), "example", "estate"),
    });
    expect(deps.config.root).toBe(join(repoRoot(), "example", "estate"));
  });

  it("accepts a real estate whose configuration and index live outside the checkout", async () => {
    const estate = await mkdtemp(join(tmpdir(), "capmap-real-estate-"));
    const home = await mkdtemp(join(tmpdir(), "capmap-home-"));
    const configDir = join(home, "config");
    await cp(checkoutConfig, configDir, { recursive: true });
    const scan = JSON.parse(await readFile(join(configDir, "scan.config.json"), "utf8")) as {
      root: string;
    };
    scan.root = estate;
    await writeFile(join(configDir, "scan.config.json"), JSON.stringify(scan));
    const deps = await buildDeps({ CAPMAP_CONFIG_DIR: configDir });
    expect(deps.config.root).toBe(estate);
  });
});

describe("committed index", () => {
  it("describes only the bundled example estate", async () => {
    const manifest = JSON.parse(
      await readFile(join(repoRoot(), "index", "index.json"), "utf8"),
    ) as { root: string; repos: Array<{ path: string }> };
    expect(manifest.root).toBe("example/estate");
    for (const repo of manifest.repos) {
      expect(existsSync(join(repoRoot(), manifest.root, repo.path))).toBe(true);
    }
  });
});
