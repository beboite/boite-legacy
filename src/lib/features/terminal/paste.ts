/** What Ctrl+V sends, and what an agent CLI pastes an image on. */
export const CTRL_V = "\x16";

/**
 * Whether a clipboard read failed only because nothing on it was text.
 *
 * Most of the time that is a screenshot. The Tauri plugin rejects rather than
 * answering "", with arboard's sentence and no code, so the sentence is what is
 * matched.
 */
export function clipboardHasNoText(err: unknown): boolean {
  const text = String(err).toLowerCase();
  return (
    text.includes("not available in the requested format") ||
    text.includes("clipboard is empty")
  );
}
