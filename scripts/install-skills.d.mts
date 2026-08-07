/**
 * Types for the skill installer.
 *
 * The installer itself is plain JavaScript on purpose: it must run with bare
 * `node` before any build step exists, so it is never compiled. This
 * declaration lets the test suite typecheck against it without dragging it
 * into the build.
 */

export interface PlannedLink {
  name: string;
  /** Absolute path of the symlink to create. */
  target: string;
  /** Absolute path in this repository that the symlink points at. */
  source: string;
}

export interface PlanLinksArgs {
  sourceDir: string;
  skillsRoot: string;
}

export declare function planLinks(args: PlanLinksArgs): Promise<PlannedLink[]>;
export declare function resolveSkillsRoot(
  env: NodeJS.ProcessEnv,
  home: string,
): string;
export declare function skillsSourceDir(): string;
