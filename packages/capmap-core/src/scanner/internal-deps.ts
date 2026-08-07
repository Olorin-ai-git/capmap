import type { ParsedManifest } from "./manifest-npm.js";

/** A discovered unit, reduced to what dependency classification needs. */
export interface ClassifiableUnit {
  manifest: ParsedManifest;
}

/**
 * Reclassify dependency edges using the packages actually discovered in this
 * scan, rather than only the scope prefixes named in configuration.
 *
 * Configured `internalScopes` cannot scale across an estate: every repository
 * picks its own scope, so a global list silently classifies a sibling package
 * as a third-party dependency in every repository whose scope is absent. The
 * consequence is not cosmetic — `internalConsumers` carries the joint-largest
 * significance weight, so an unlisted scope zeroes it for every package in that
 * repository at once, and genuinely reusable libraries fall below the
 * threshold.
 *
 * A dependency whose name matches a package found in the same scan is internal
 * by definition, whatever it is called. Configured scopes remain useful for the
 * cross-repository case, where the depended-upon package lives outside the
 * repository currently being scanned, so both rules apply and this one only
 * ever promotes.
 */
export function reclassifyInternalDeps<T extends ClassifiableUnit>(
  units: T[],
): T[] {
  const discovered = new Set(units.map((unit) => unit.manifest.name));

  return units.map((unit) => {
    const promoted = unit.manifest.deps.external.filter((dep) =>
      discovered.has(dep),
    );
    if (promoted.length === 0) return unit;

    return {
      ...unit,
      manifest: {
        ...unit.manifest,
        deps: {
          internal: [
            ...new Set([...unit.manifest.deps.internal, ...promoted]),
          ].sort(),
          external: unit.manifest.deps.external.filter(
            (dep) => !discovered.has(dep),
          ),
        },
      },
    };
  });
}

/**
 * Whether a unit exposes something another package could import.
 *
 * Deliberately independent of `private`. In a workspace monorepo `private: true`
 * means "not published to a registry", which is the norm for shared internal
 * libraries and says nothing about reusability — a private package with five
 * internal consumers is among the most reusable things an estate contains. What
 * matters is whether an entry point resolves at all, which is what separates a
 * library from an application shell.
 */
export function exposesEntryPoint(manifest: ParsedManifest): boolean {
  return manifest.entryRelPath !== null;
}
