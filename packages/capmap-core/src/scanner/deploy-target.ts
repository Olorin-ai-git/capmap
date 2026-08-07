import { access, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { z } from "zod";
import type { DeployTargetSchema } from "../model/index-schema.js";

export type DeployTarget = z.infer<typeof DeployTargetSchema>;

const FIREBASE_CONFIG = "firebase.json";

const FILE_KINDS: ReadonlyArray<{ file: string; kind: DeployTarget["kind"] }> =
  [
    { file: "apphosting.yaml", kind: "app-hosting" },
    { file: "cloudbuild.yaml", kind: "cloud-build" },
    { file: "docker-compose.yml", kind: "docker-compose" },
    { file: "Dockerfile", kind: "docker" },
    { file: FIREBASE_CONFIG, kind: "firebase-hosting" },
  ];

async function classifyFirebase(path: string): Promise<DeployTarget["kind"]> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    if (raw["functions"] !== undefined) return "firebase-functions";
  } catch {
    /* fall through to hosting */
  }
  return "firebase-hosting";
}

async function probe(dir: string): Promise<DeployTarget | null> {
  for (const { file, kind } of FILE_KINDS) {
    const path = join(dir, file);
    try {
      await access(path);
      return {
        kind: file === FIREBASE_CONFIG ? await classifyFirebase(path) : kind,
        config: file,
      };
    } catch {
      /* next file */
    }
  }
  return null;
}

export async function detectDeployTarget(
  dirAbs: string,
  repoRootAbs: string,
): Promise<DeployTarget | null> {
  const own = await probe(dirAbs);
  if (own !== null) return own;
  const parent = dirname(dirAbs);
  const fromRoot = relative(repoRootAbs, parent);
  const withinRepo = !fromRoot.startsWith(".." + sep) && fromRoot !== "..";
  if (!withinRepo || parent === dirAbs) return null;
  return probe(parent);
}
