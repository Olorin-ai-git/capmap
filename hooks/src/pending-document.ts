import { readFile } from "node:fs/promises";
import { componentsHash, extractComponents } from "./components-hash.js";

/**
 * Stands in for "the post-edit document could not be reconstructed". It can
 * never equal a real component hash, so the decision treats it as a change and
 * blocks — failing closed on an edit whose effect is unknown.
 */
export const AMBIGUOUS_EDIT_HASH = "sha256:unreconstructable-edit";

export interface PendingEdit {
  content?: string;
  new_string?: string;
  old_string?: string;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * The document as it will be once the pending call lands.
 *
 * A Write supplies the whole file. An Edit supplies only a replacement region,
 * and hashing that region alone was a hole: replacing `- billing` with
 * `- authentication` contains no `## Components` heading, so extraction found
 * nothing, the hook fell back to the pre-edit file, and the changed component
 * list matched the old gate record. The edit is therefore applied to the
 * on-disk document and the result hashed.
 *
 * Reconstruction fails closed. If `old_string` is absent or appears more than
 * once, the post-edit text is genuinely unknown, and a guard that cannot tell
 * must not assume nothing changed.
 */
export async function pendingDocument(
  fileAbs: string,
  input: PendingEdit | undefined,
): Promise<{ text: string | null; ambiguous: boolean }> {
  if (input?.content !== undefined) {
    return { text: input.content, ambiguous: false };
  }

  const current = await readOrNull(fileAbs);
  if (input?.new_string === undefined) {
    return { text: current, ambiguous: false };
  }
  if (current === null) {
    return { text: input.new_string, ambiguous: false };
  }

  const target = input.old_string;
  if (target === undefined || target === "") {
    return { text: null, ambiguous: true };
  }
  const first = current.indexOf(target);
  if (first < 0) return { text: null, ambiguous: true };
  if (current.indexOf(target, first + target.length) >= 0) {
    return { text: null, ambiguous: true };
  }
  return {
    text:
      current.slice(0, first) +
      input.new_string +
      current.slice(first + target.length),
    ambiguous: false,
  };
}

/**
 * Hash of the component list the document will declare after the pending call,
 * or null when it declares none. Null means "cannot tell", which the decision
 * treats as no evidence of change, so prose-only edits do not invalidate a gate.
 */
export async function pendingHash(
  fileAbs: string,
  input: PendingEdit | undefined,
): Promise<string | null> {
  const { text, ambiguous } = await pendingDocument(fileAbs, input);
  if (ambiguous) return AMBIGUOUS_EDIT_HASH;
  if (text === null) return null;
  const components = extractComponents(text);
  return components === null ? null : componentsHash(components);
}
