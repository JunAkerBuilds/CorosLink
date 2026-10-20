/**
 * Whether the Coach transcript should jump to the newest content after an update: always for another
 * conversation or a message the athlete just sent, otherwise only while they're reading at the bottom,
 * so a card updating in place (a confirmed delete, a saved plan) leaves the scroll position alone.
 */
export function shouldFollowTranscript(
  previous: { session: string | null; length: number },
  next: { session: string | null; length: number; lastIsUserMessage: boolean },
  pinnedToBottom: boolean
): boolean {
  if (next.session !== previous.session) return true;
  if (next.length > previous.length && next.lastIsUserMessage) return true;
  return pinnedToBottom;
}

/** Within this many pixels of the end counts as reading at the bottom. */
export const TRANSCRIPT_BOTTOM_SLACK_PX = 80;
