/**
 * Enforce the repository's source constraints that a type checker cannot see:
 * no placeholder vocabulary, no direct console output, and a hard file-length
 * ceiling. Runs over source only — tests are exempt by design, because a test
 * naming a "stub" or asserting on a placeholder string is describing behaviour
 * rather than shipping it.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const FORBIDDEN_TERMS = [
  "TODO",
  "FIXME",
  "TBD",
  "PLACEHOLDER",
  "NotImplementedError",
  "not implemented",
];

/**
 * Matched case-sensitively as whole words, because each has a common innocent
 * substring: "MOCK" inside "mockingbird", "FAKE" inside "faker", "temp" inside
 * "template" and "temporary directory", "STUB" inside "stubborn".
 */
const FORBIDDEN_WORDS = [
  "MOCK",
  "STUB",
  "FAKE",
  "DUMMY",
  "LATER",
  "PENDING",
  "skeleton",
];

const CONSOLE_CALL = /\bconsole\.(log|error|warn|info|debug)\b/;

/**
 * Literal configuration: an endpoint or a machine-specific absolute path
 * written into source instead of read from the config layer.
 *
 * Deliberately narrow. These four are unambiguous — there is no legitimate
 * reason for source in this repository to name a host, a URL scheme or somebody's
 * home directory, and all four are zero today — so the check can be an assertion
 * rather than a heuristic that needs a suppression mechanism the moment it lands.
 * The acceptance criterion claimed "no literal configuration" while nothing
 * checked for any of it, which an independent review was right to call out.
 */
const LITERAL_CONFIG = [
  [/https?:\/\//, "a literal URL"],
  [/\blocalhost\b/, "a literal host"],
  [/["'`]\/Users\//, "an absolute macOS home path"],
  [/["'`]\/home\//, "an absolute Linux home path"],
];
const SOURCE_ROOTS = [
  "packages/capmap-core/src",
  "packages/capmap-cli/src",
  "packages/capmap-mcp/src",
  "hooks/src",
];
/**
 * The verification scripts are held to the length ceiling and to nothing else.
 *
 * They are load-bearing evidence — the acceptance report's figures come out of
 * them — so "no file over 200 lines" should mean what it says rather than
 * quietly excluding the directory that produces the report. The other rules do
 * not apply: writing to stdout IS their interface, and a checker that
 * deliberately plants a placeholder term to prove it is detected must be allowed
 * to contain one.
 */
const LENGTH_ONLY_ROOTS = ["scripts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
/**
 * Shell counts. The ceiling was announced as covering `scripts/` while the walk
 * skipped every `.sh` in it, and the longest file in the repository — the
 * verification runner itself, at 292 lines — was the one thing the claim was
 * least true of. A rule with an exemption for its own biggest violator is not a
 * rule.
 */
const LENGTH_ONLY_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, ".sh"]);
const MAX_FILE_LINES = 200;
const EXIT_FAILURE = 1;

const failures = [];

function wordPattern(word) {
  return new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`);
}

const WORD_PATTERNS = FORBIDDEN_WORDS.map((word) => [word, wordPattern(word)]);

async function inspect(path, repoRoot, lengthOnly) {
  const shown = relative(repoRoot, path);
  const text = await readFile(path, "utf8");
  const lines = text.split("\n");

  if (lines.length > MAX_FILE_LINES) {
    failures.push(
      `${shown}: ${lines.length} lines exceeds the ${MAX_FILE_LINES}-line limit`,
    );
  }
  if (lengthOnly) return;

  lines.forEach((line, index) => {
    const at = `${shown}:${index + 1}`;
    for (const term of FORBIDDEN_TERMS) {
      if (line.includes(term)) failures.push(`${at}: forbidden term "${term}"`);
    }
    for (const [word, pattern] of WORD_PATTERNS) {
      if (pattern.test(line)) failures.push(`${at}: forbidden term "${word}"`);
    }
    if (CONSOLE_CALL.test(line)) {
      failures.push(
        `${at}: console output is forbidden in source; ` +
          `use the Logger port for diagnostics or the Writer port for output`,
      );
    }
    for (const [pattern, what] of LITERAL_CONFIG) {
      if (pattern.test(line)) {
        failures.push(`${at}: ${what} belongs in the config layer, not in source`);
      }
    }
  });
}

async function walk(dir, repoRoot, lengthOnly = false) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, repoRoot, lengthOnly);
      continue;
    }
    const extensions = lengthOnly ? LENGTH_ONLY_EXTENSIONS : SOURCE_EXTENSIONS;
    if (!extensions.has(extname(entry.name))) continue;
    await inspect(full, repoRoot, lengthOnly);
  }
}

const repoRoot = process.cwd();
for (const root of SOURCE_ROOTS) await walk(join(repoRoot, root), repoRoot);
for (const root of LENGTH_ONLY_ROOTS) await walk(join(repoRoot, root), repoRoot, true);

if (failures.length > 0) {
  process.stderr.write(`${failures.sort().join("\n")}\n`);
  process.stderr.write(`\n${failures.length} violation(s)\n`);
  process.exit(EXIT_FAILURE);
}

process.stdout.write(
  `source constraints satisfied across ${SOURCE_ROOTS.length} source roots: ` +
  `no file over ${MAX_FILE_LINES} lines, none of ${FORBIDDEN_TERMS.length + FORBIDDEN_WORDS.length} ` +
  `placeholder terms, no console output, no literal endpoints or absolute home paths\n` +
  `plus the ${MAX_FILE_LINES}-line ceiling across ${LENGTH_ONLY_ROOTS.join(", ")}\n`,
);
