import { access, readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

export interface PackageMetrics {
  loc: number;
  hasTests: boolean;
  hasReadme: boolean;
  testCount: number;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".mts",
  ".cts",
]);
const TEST_DIR_NAMES = new Set(["test", "tests", "__tests__", "spec"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|^test_.*\.py$|_test\.py$/;
const README_FILE = "README.md";

async function walkFiles(
  dir: string,
  exclude: Set<string>,
  visit: (path: string, name: string, inTestDir: boolean) => void,
  inTestDir = false,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (exclude.has(entry.name)) continue;
      await walkFiles(
        full,
        exclude,
        visit,
        inTestDir || TEST_DIR_NAMES.has(entry.name),
      );
      continue;
    }
    visit(full, entry.name, inTestDir);
  }
}

export async function collectMetrics(
  dirAbs: string,
  excludePaths: string[],
): Promise<PackageMetrics> {
  const exclude = new Set(excludePaths);
  const sourceFiles: string[] = [];
  let testCount = 0;

  await walkFiles(dirAbs, exclude, (path, name, inTestDir) => {
    if (!SOURCE_EXTENSIONS.has(extname(name))) return;
    if (inTestDir || TEST_FILE.test(name)) {
      testCount += 1;
      return;
    }
    sourceFiles.push(path);
  });

  let loc = 0;
  for (const file of sourceFiles) {
    try {
      const text = await readFile(file, "utf8");
      loc += text.length === 0 ? 0 : text.split("\n").length;
    } catch {
      /* unreadable file contributes nothing */
    }
  }

  let hasReadme = true;
  try {
    await access(join(dirAbs, README_FILE));
  } catch {
    hasReadme = false;
  }

  return { loc, hasTests: testCount > 0, hasReadme, testCount };
}
