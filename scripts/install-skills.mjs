#!/usr/bin/env node
import {
  lstat,
  mkdir,
  readdir,
  readlink,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Claude Code reads its configuration from this directory when the variable is set. */
const CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";
const DEFAULT_CONFIG_DIR_NAME = ".claude";
const SKILLS_DIR_NAME = "skills";
const SKILL_FILE_NAME = "SKILL.md";

export const LINKED = "linked";
export const RELINKED = "relinked";
export const ALREADY_LINKED = "already-linked";
export const REFUSED = "refused";

/** Directory holding the skill sources in this repository. */
export function skillsSourceDir() {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    SKILLS_DIR_NAME,
  );
}

/** Directory the skills are installed into, honouring an explicit config directory. */
export function resolveSkillsRoot(env, home) {
  const configured = env[CONFIG_DIR_ENV];
  const configDir =
    typeof configured === "string" && configured.length > 0
      ? configured
      : join(home, DEFAULT_CONFIG_DIR_NAME);
  return join(configDir, SKILLS_DIR_NAME);
}

async function isSkillDir(sourceDir, name) {
  try {
    const entry = await stat(join(sourceDir, name, SKILL_FILE_NAME));
    return entry.isFile();
  } catch {
    return false;
  }
}

/** Pure planning pass: which source directory links to which target, sorted by name. */
export async function planLinks({ sourceDir, skillsRoot }) {
  const names = (await readdir(sourceDir)).sort();
  const links = [];
  for (const name of names) {
    if (!(await isSkillDir(sourceDir, name))) continue;
    links.push({
      name,
      source: join(sourceDir, name),
      target: join(skillsRoot, name),
    });
  }
  return links;
}

async function linkOne(link) {
  let existing;
  try {
    existing = await lstat(link.target);
  } catch {
    await symlink(link.source, link.target);
    return { ...link, action: LINKED, detail: null };
  }

  if (!existing.isSymbolicLink()) {
    return {
      ...link,
      action: REFUSED,
      detail: "a real directory or file already occupies the target",
    };
  }

  const current = await readlink(link.target);
  if (current === link.source) {
    return { ...link, action: ALREADY_LINKED, detail: null };
  }

  await unlink(link.target);
  await symlink(link.source, link.target);
  return { ...link, action: RELINKED, detail: `replaced link to ${current}` };
}

/** Install every skill in the repository, never overwriting anything that is not a symlink. */
export async function installSkills({ env, home, sourceDir }) {
  const skillsRoot = resolveSkillsRoot(env, home);
  await mkdir(skillsRoot, { recursive: true });
  const links = await planLinks({ sourceDir, skillsRoot });
  const results = [];
  for (const link of links) results.push(await linkOne(link));
  return results;
}

function report(results, out, err) {
  for (const result of results) {
    const suffix = result.detail === null ? "" : ` (${result.detail})`;
    const line = `${result.action} ${result.name} -> ${result.target}${suffix}\n`;
    if (result.action === REFUSED) err.write(line);
    else out.write(line);
  }
}

async function main() {
  const results = await installSkills({
    env: process.env,
    home: homedir(),
    sourceDir: skillsSourceDir(),
  });
  report(results, process.stdout, process.stderr);
  process.exitCode = results.some((r) => r.action === REFUSED) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
