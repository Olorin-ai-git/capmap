/**
 * Check every consumer edge in the index against the consumer's own manifest.
 *
 * Deliberately independent of the scanner: it re-reads `package.json` and
 * `pyproject.toml` from disk rather than calling the code that produced the
 * edges, because a checker built on the indexer's own parser would agree with
 * it by construction and prove nothing.
 *
 * Two things it must establish, and an earlier version established only the
 * first:
 *
 *   1. the consumer really declares a dependency by that name;
 *   2. the edge points at the RIGHT package of that name. Twelve names in this
 *      estate are declared by more than one package — `@olorin/design-tokens`
 *      twice, `olorin-shared` three times — and seven of those names carry
 *      edges. Asking only "is this name declared?" passes whichever copy the
 *      index happened to name, so it cannot tell a correct attribution from a
 *      swapped one. Ambiguous names are resolved here by directory proximity,
 *      independently, and the edge must agree.
 *
 * Dependency declarations are read from the dependency sections only. Searching
 * a whole TOML file for a quoted name would also match a URL, a description or
 * a tool setting that happens to contain it.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  NPM_MANIFEST,
  PYTHON_MANIFEST,
  declaredNames,
} from "./lib/dependency-manifests.mjs";

const CONFIG_FILE = "config/scan.config.json";
const MANIFEST_FILE = "index.json";
const REPOS_DIR = "repos";

const indexDir = JSON.parse(readFileSync(CONFIG_FILE, "utf8")).index.dir;
const manifest = JSON.parse(readFileSync(join(indexDir, MANIFEST_FILE), "utf8"));
const reposDir = join(indexDir, REPOS_DIR);

/** Every unit the index knows by id, significant and minor alike — a minor
 * package is still a legitimate consumer, and fifteen of the edges have one. */
const units = new Map();
const providers = [];
for (const file of readdirSync(reposDir)) {
  const repo = JSON.parse(readFileSync(join(reposDir, file), "utf8"));
  for (const pkg of repo.packages) {
    units.set(pkg.id, { path: pkg.path, manifest: pkg.manifest });
    providers.push(pkg);
  }
  for (const unit of repo.minor) {
    units.set(unit.id, { path: unit.path, manifest: null });
  }
}

const sameName = new Map();
for (const provider of providers) {
  sameName.set(provider.name, [...(sameName.get(provider.name) ?? []), provider]);
}

/** Minor units carry no manifest field, so the kind is settled from disk. */
function manifestPath(unit) {
  const named = unit.manifest === null ? null : join(manifest.root, unit.path, unit.manifest);
  if (named !== null && existsSync(named)) return named;
  for (const candidate of [NPM_MANIFEST, PYTHON_MANIFEST]) {
    const probed = join(manifest.root, unit.path, candidate);
    if (existsSync(probed)) return probed;
  }
  return null;
}

/** Shared leading path segments — the estate's own resolution rule. */
function sharedDepth(a, b) {
  const left = a.split("/");
  const right = b.split("/");
  let depth = 0;
  while (depth < left.length && depth < right.length && left[depth] === right[depth]) depth += 1;
  return depth;
}

/**
 * Which package of this name a consumer at this path actually resolves to.
 * Returns null when two candidates are equally close, because an edge that
 * cannot be resolved independently must not count as proven.
 */
function nearestProvider(name, consumerPath) {
  const candidates = sameName.get(name) ?? [];
  if (candidates.length <= 1) return candidates[0] ?? null;
  const scored = candidates
    .map((candidate) => ({ candidate, depth: sharedDepth(candidate.path, consumerPath) }))
    .sort((a, b) => b.depth - a.depth);
  if (scored.length > 1 && scored[0].depth === scored[1].depth) return null;
  return scored[0].candidate;
}

let checked = 0;
let real = 0;
let ambiguous = 0;
const unproven = [];
for (const provider of providers) {
  for (const consumerId of provider.consumers) {
    checked += 1;
    const consumer = units.get(consumerId);
    const file = consumer === undefined ? null : manifestPath(consumer);
    if (file === null) {
      unproven.push(`${consumerId} -> ${provider.name}: no manifest on disk`);
      continue;
    }
    if (!declaredNames(file).has(provider.name)) {
      unproven.push(`${consumerId} -> ${provider.name}: not declared in ${file}`);
      continue;
    }
    if ((sameName.get(provider.name) ?? []).length > 1) {
      ambiguous += 1;
      const nearest = nearestProvider(provider.name, consumer.path);
      if (nearest === null) {
        unproven.push(`${consumerId} -> ${provider.name}: two packages of that name are equally close`);
        continue;
      }
      if (nearest.id !== provider.id) {
        unproven.push(
          `${consumerId} -> ${provider.id}: declared name is ambiguous and resolves to ${nearest.id}`,
        );
        continue;
      }
    }
    real += 1;
  }
}

process.stdout.write(
  `edges checked: ${checked} real: ${real} false: ${unproven.length}\n` +
  `of those, ${ambiguous} edge(s) name a package whose name is declared by more ` +
  `than one package, and were resolved by directory proximity\n` +
  unproven.map((edge) => `  unproven: ${edge}\n`).join(""),
);
process.exit(unproven.length === 0 ? 0 : 1);
