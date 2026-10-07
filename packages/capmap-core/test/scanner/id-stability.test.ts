import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildUnits } from "../../src/scanner/unit.js";
import { parsePyManifest } from "../../src/scanner/manifest-py.js";

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capmap-ids-"));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), body);
  }
  return root;
}

/**
 * SP-3 audit: Python sub-packages joined id assignment in path order, so a
 * sub-package sorting before a manifest package took the short id the manifest
 * package held, and carried enrichment and domains rebound to the wrong code.
 */
describe("manifest packages keep their ids when sub-packages appear", () => {
  it("gives the short id to the manifest package, not to a sub-package sorting before it", async () => {
    const root = await tree({
      "est/r/backend/pyproject.toml": '[project]\nname = "backend"\n',
      "est/r/backend/app/__init__.py": "",
      "est/r/backend/app/auth/__init__.py": "def login():\n    pass\n",
      "est/r/packages/auth/package.json": JSON.stringify({ name: "@olorin/auth" }),
      "est/r/packages/auth/src/index.ts": "export const login = 1;\n",
    });
    const units = await buildUnits({
      rootAbs: join(root, "est"),
      repo: { id: "r", path: "r", tier: "core", vcs: "none" },
      internalScopes: ["@olorin/"],
      excludePaths: [],
      python: { subpackageMaxDepth: 3 },
    });
    const byPath = new Map(units.map((u) => [u.candidate.relPath, u.id]));
    expect(byPath.get("packages/auth")).toBe("r/auth");
    expect(byPath.get("backend/app/auth")).not.toBe("r/auth");
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length);
  });
});

/**
 * SP-3 audit: with no declared or distribution-named package, the import-root
 * fallback listed every top-level package, tests included, and the first one
 * became the project's entry.
 */
describe("import roots never name a test package", () => {
  it("does not choose tests/ as the entry of a project whose package sorts after it", async () => {
    const root = await tree({
      "p/pyproject.toml": '[project]\nname = "olorin-cvplus"\n',
      "p/tests/__init__.py": "",
      "p/web/__init__.py": "def serve():\n    pass\n",
    });
    const parsed = await parsePyManifest(join(root, "p"), [], []);
    expect(parsed.importRoots).toEqual(["web"]);
    expect(parsed.entryRelPath).toBe("web/__init__.py");
  });

  it("does not take a test package from a declared setuptools find either", async () => {
    const root = await tree({
      "p/pyproject.toml": '[project]\nname = "x"\n[tool.setuptools.packages.find]\nwhere = ["."]\n',
      "p/aaa_tests/__init__.py": "",
      "p/test/__init__.py": "",
      "p/zlib/__init__.py": "",
    });
    const parsed = await parsePyManifest(join(root, "p"), [], []);
    expect(parsed.importRoots).not.toContain("test");
  });
});
