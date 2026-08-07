import { Project } from "ts-morph";

export interface ExportResult {
  exports: string[];
  extractionFailed: boolean;
}

/**
 * Extract the public export names of a TypeScript or JavaScript entry file.
 *
 * The file is parsed in isolation: no tsconfig is loaded and module resolution
 * is skipped, so a package whose dependencies are not installed still yields a
 * usable surface. Unresolvable re-exports are recovered from the syntactic
 * export declarations.
 */
export async function extractTsExports(
  absEntryPath: string,
): Promise<ExportResult> {
  try {
    const project = new Project({
      useInMemoryFileSystem: false,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true },
    });
    const source = project.addSourceFileAtPath(absEntryPath);
    const names = new Set<string>();

    for (const [name] of source.getExportedDeclarations()) {
      names.add(name);
    }
    for (const decl of source.getExportDeclarations()) {
      for (const spec of decl.getNamedExports()) names.add(spec.getName());
    }

    return { exports: [...names].sort(), extractionFailed: false };
  } catch {
    return { exports: [], extractionFailed: true };
  }
}
