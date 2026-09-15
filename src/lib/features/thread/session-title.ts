import type { SessionHit } from "$lib/backend/types";

export function sessionTitleUpdate(
  sessionId: string | null | undefined,
  current: string | null | undefined,
  hit: SessionHit,
  manuallyRenamed: boolean,
): string | null {
  if (manuallyRenamed || hit.id !== sessionId) return null;
  const title = hit.name?.trim() || (!current ? hit.title?.trim() : null);
  return title && title !== current ? title : null;
}
