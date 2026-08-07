import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  fixtureEstateRoot,
  loadFixtureConfig,
  materialiseEstate,
} from "./fixture-estate.js";

const execFileAsync = promisify(execFile);

describe("fixture estate", () => {
  it("exposes five repositories spanning every tier and vcs mode", async () => {
    const cfg = await loadFixtureConfig();
    expect(cfg.repos.repos.map((r) => r.id).sort()).toEqual([
      "alpha",
      "beta",
      "delta",
      "epsilon",
      "gamma",
    ]);
    expect(cfg.repos.repos.find((r) => r.id === "gamma")?.vcs).toBe("none");
    expect(cfg.repos.repos.find((r) => r.id === "epsilon")?.tier).toBe(
      "external",
    );
  });

  it("places a workspace monorepo at alpha and a python project at beta", async () => {
    await access(
      join(fixtureEstateRoot(), "alpha", "packages", "ui-kit", "package.json"),
    );
    await access(join(fixtureEstateRoot(), "beta", "pyproject.toml"));
  });

  it("materialises real git repositories from the committed dot-git markers", async () => {
    const dest = await materialiseEstate();
    try {
      const head = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: join(dest, "alpha"),
      });
      expect(head.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
      await expect(access(join(dest, "alpha", "dot-git"))).rejects.toThrow();
      await expect(access(join(dest, "gamma", ".git"))).rejects.toThrow();
      const logged = await execFileAsync(
        "git",
        ["log", "-1", "--format=%cI", "--", "packages/ui-kit"],
        { cwd: join(dest, "alpha") },
      );
      expect(logged.stdout.trim().length).toBeGreaterThan(0);
    } finally {
      await rm(dest, { recursive: true, force: true });
    }
  });
});
