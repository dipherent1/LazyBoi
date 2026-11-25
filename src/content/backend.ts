// What the on-page widget needs from "the rest of lazyBoi". Two implementations:
// the Chrome extension (service worker) and a localStorage one used by the playground harness.
import type { FormSchema } from "../shared/types";

export type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

export interface WidgetBackend {
  /** Form page: scan this page and register a session for it. */
  scanAndRegister(): Promise<Res<{ schema: FormSchema }>>;
  markCopied(session: string): Promise<void>;
  /** Form page: use a reply the chat page queued earlier. code "no_reply" / "no_session" when there's nothing. */
  fillFromPending(): Promise<Res>;
  /** Route pasted reply text to its form (opens the preview there). */
  submitReply(text: string): Promise<Res>;
  /** Chat page: the most recently copied form. */
  latestForm(): Promise<Res<{ schema: FormSchema; title: string }>>;
  /** Chat page: hand a reply to the form page for later. */
  queueReply(text: string): Promise<Res<{ session: string; formTitle: string }>>;
}
