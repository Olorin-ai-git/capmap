import { componentsHash, extractComponents } from "./components-hash.js";
import { readRegularFile } from "./read-regular.js";

/**
 * Stands in for "the post-edit document could not be reconstructed". It can
 * never equal a real component hash, so the decision treats it as a change and
 * blocks — failing closed on an edit whose effect is unknown.
 */
export const AMBIGUOUS_EDIT_HASH = "sha256:unreconstructable-edit";
const CR = "\r";
const CRLF = /\r\n/g;
const LF = "\n";

/** One replacement, as Edit sends it and as each entry of MultiEdit's `edits`. */
export interface EditOperation {
  new_string?: string;
  old_string?: string;
  /** Replace every occurrence; a repeated `old_string` is then unambiguous. */
  replace_all?: boolean;
}

export interface PendingEdit extends EditOperation {
  content?: string;
  /** MultiEdit: applied in order, each to the result of the one before. */
  edits?: EditOperation[];
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readRegularFile(path);
  } catch {
    return null;
  }
}

/** The text after one replacement, or null when its effect cannot be known. */
function applyEdit(text: string, edit: EditOperation): string | null {
  const target = edit.old_string;
  if (target === undefined || target === "" || edit.new_string === undefined) {
    return null;
  }
  const first = text.indexOf(target);
  if (first < 0) return null;
  if (edit.replace_all === true) return text.split(target).join(edit.new_string);
  if (text.indexOf(target, first + target.length) >= 0) return null;
  return text.slice(0, first) + edit.new_string + text.slice(first + target.length);
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
 * Reconstruction fails closed. If `old_string` is absent, missing from the
 * document, or appears more than once without `replace_all`, the post-edit text
 * is genuinely unknown, and a guard that cannot tell must not assume nothing
 * changed.
 */
export async function pendingDocument(
  fileAbs: string,
  input: PendingEdit | undefined,
): Promise<{ text: string | null; ambiguous: boolean }> {
  if (input?.content !== undefined) {
    return { text: input.content, ambiguous: false };
  }

  const current = await readOrNull(fileAbs);
  const edits = input?.edits ?? (input?.new_string === undefined ? [] : [input]);
  if (edits.length === 0) return { text: current, ambiguous: false };

  // Claude Code's Edit sends LF line endings for a CRLF file; match them on the
  // LF form, which hashes the same (components-hash.ts reads either).
  const lfEdit = edits.some((edit) => !(edit.old_string ?? "").includes(CR));
  // Creating a file: its first replacement is the whole initial content.
  let text = current !== null && lfEdit ? current.replace(CRLF, LF) : current;
  let pending = edits;
  if (text === null) {
    text = pending[0]?.new_string ?? "";
    pending = pending.slice(1);
  }
  for (const edit of pending) {
    const next = applyEdit(text, edit);
    if (next === null) return { text: null, ambiguous: true };
    text = next;
  }
  return { text, ambiguous: false };
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
