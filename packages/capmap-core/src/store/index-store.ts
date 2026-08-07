import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  INDEX_SCHEMA_VERSION,
  IndexManifestSchema,
  RepoIndexSchema,
  type IndexManifest,
  type RepoIndex,
} from "../model/index-schema.js";

const MANIFEST_FILE = "index.json";
const REPOS_DIR = "repos";
const JSON_INDENT = 2;
const JSON_SUFFIX = ".json";
const WRITING_SUFFIX = ".writing";

export interface IndexStoreOptions {
  indexDirAbs: string;
  expectedVersion?: number;
}

export class IndexStore {
  private readonly dir: string;
  private readonly expectedVersion: number;

  constructor(options: IndexStoreOptions) {
    this.dir = options.indexDirAbs;
    this.expectedVersion = options.expectedVersion ?? INDEX_SCHEMA_VERSION;
  }

  private async writeAtomic(path: string, value: unknown): Promise<void> {
    const temp = `${path}${WRITING_SUFFIX}`;
    await writeFile(
      temp,
      JSON.stringify(value, null, JSON_INDENT) + "\n",
      "utf8",
    );
    await rename(temp, path);
  }

  private assertVersion(found: unknown, what: string): void {
    if (found !== this.expectedVersion) {
      throw new Error(
        `${what} was written with schema version ${String(found)}, expected ` +
          `${this.expectedVersion}; run "capmap scan --all" to rebuild the index`,
      );
    }
  }

  async writeRepo(index: RepoIndex): Promise<void> {
    await mkdir(join(this.dir, REPOS_DIR), { recursive: true });
    await this.writeAtomic(
      join(this.dir, REPOS_DIR, `${index.repo}${JSON_SUFFIX}`),
      index,
    );
  }

  async readRepo(id: string): Promise<RepoIndex> {
    const path = join(this.dir, REPOS_DIR, `${id}${JSON_SUFFIX}`);
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      schemaVersion?: unknown;
    };
    this.assertVersion(raw.schemaVersion, `index for repository "${id}"`);
    return RepoIndexSchema.parse(raw);
  }

  async readAllRepos(): Promise<RepoIndex[]> {
    let files: string[];
    try {
      files = await readdir(join(this.dir, REPOS_DIR));
    } catch {
      return [];
    }
    const ids = files
      .filter((file) => file.endsWith(JSON_SUFFIX))
      .map((file) => file.slice(0, -JSON_SUFFIX.length));
    return Promise.all(ids.sort().map((id) => this.readRepo(id)));
  }

  async writeManifest(manifest: IndexManifest): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.writeAtomic(join(this.dir, MANIFEST_FILE), manifest);
  }

  async readManifest(): Promise<IndexManifest> {
    let text: string;
    try {
      text = await readFile(join(this.dir, MANIFEST_FILE), "utf8");
    } catch (cause) {
      throw new Error('index manifest not found; run "capmap scan --all"', {
        cause,
      });
    }
    const raw = JSON.parse(text) as { schemaVersion?: unknown };
    this.assertVersion(raw.schemaVersion, "index manifest");
    return IndexManifestSchema.parse(raw);
  }
}
