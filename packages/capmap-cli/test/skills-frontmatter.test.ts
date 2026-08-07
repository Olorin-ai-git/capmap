import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./support/paths.js";
import {
  planLinks,
  resolveSkillsRoot,
  skillsSourceDir,
} from "../../../scripts/install-skills.mjs";

const SKILLS = ["capability-map", "reuse-gate"];

const IMPLEMENTED_COMMANDS = [
  "scan",
  "refresh",
  "search",
  "show",
  "verify",
  "gate",
  "status",
];

async function skillText(name: string): Promise<string> {
  return readFile(join(repoRoot(), "skills", name, "SKILL.md"), "utf8");
}

describe("skill definitions", () => {
  it.each(SKILLS)(
    "%s declares name and description frontmatter",
    async (name) => {
      const text = await skillText(name);
      expect(text).toMatch(/^---\n/);
      expect(text).toMatch(new RegExp(`^name:\\s*${name}$`, "m"));
      expect(text).toMatch(/^description:\s*\S/m);
    },
  );

  it.each(SKILLS)(
    "%s references only commands the CLI implements",
    async (name) => {
      const text = await skillText(name);
      const invoked = [...text.matchAll(/capmap\s+([a-z-]+)/g)].map(
        (m) => m[1],
      );
      expect(invoked.length).toBeGreaterThan(0);
      for (const command of invoked)
        expect(IMPLEMENTED_COMMANDS).toContain(command);
    },
  );

  it("reuse-gate states that REFERENCE is read-only prior art", async () => {
    const text = await skillText("reuse-gate");
    expect(text).toMatch(/REFERENCE/);
    expect(text).toMatch(/read-only prior art/i);
  });

  it("reuse-gate forbids importing external-tier capabilities", async () => {
    const text = await skillText("reuse-gate");
    expect(text).toMatch(/`external`/);
    expect(text).toMatch(/never be imported/i);
    expect(text).toMatch(/intellectual[- ]property/i);
  });
});

describe("install-skills", () => {
  it("places the skills root under the default config directory", () => {
    expect(resolveSkillsRoot({}, "/home/someone")).toBe(
      join("/home/someone", ".claude", "skills"),
    );
  });

  it("honours an explicit config directory from the environment", () => {
    expect(
      resolveSkillsRoot({ CLAUDE_CONFIG_DIR: "/opt/cc" }, "/home/someone"),
    ).toBe(join("/opt/cc", "skills"));
  });

  it("plans one link per skill directory without touching the filesystem", async () => {
    const links = await planLinks({
      sourceDir: skillsSourceDir(),
      skillsRoot: "/home/someone/.claude/skills",
    });
    expect(links.map((l: { name: string; target: string; source: string }) => l.name)).toEqual(SKILLS);
    expect(links.map((l: { name: string; target: string; source: string }) => l.target)).toEqual(
      SKILLS.map((name) => join("/home/someone/.claude/skills", name)),
    );
    expect(links.map((l: { name: string; target: string; source: string }) => l.source)).toEqual(
      SKILLS.map((name) => join(repoRoot(), "skills", name)),
    );
  });
});
