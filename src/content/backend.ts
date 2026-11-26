// What the on-page widget needs from "the rest of lazyBoi". Two implementations:
// the Chrome extension (service worker) and a localStorage one used by the playground harness.
import type { FillSummary, FormSchema } from "../shared/types";

export type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string; code?: string; debug?: unknown };

/** An open chat tab the user can pick. */
export interface ChatTab {
  tabId: number;
  host: string;
  title: string;
}

export interface WidgetBackend {
  /** Form page: scan this page and register a session for it. */
  scanAndRegister(): Promise<Res<{ schema: FormSchema }>>;
  markCopied(session: string): Promise<void>;
  /** Form page: fill from a reply the chat page queued earlier. code "no_reply" / "no_session" when there's nothing. */
  fillFromPending(): Promise<Res<{ summary?: FillSummary }>>;
  /** Fill the form that a pasted reply belongs to. */
  submitReply(text: string): Promise<Res<{ summary?: FillSummary }>>;
  /** Chat page: the most recently copied form. */
  latestForm(): Promise<Res<{ schema: FormSchema; title: string }>>;
  /** Chat page: hand a reply to the form page for later. */
  queueReply(text: string): Promise<Res<{ session: string; formTitle: string }>>;
  /** Put back what the last fill changed. */
  undo(): Promise<Res<{ restored: number }>>;
  /** Open tabs on supported chat sites (the user picks one every time). */
  chatTabs(): Promise<Res<{ tabs: ChatTab[] }>>;
  /** Send this form's prompt in that chat tab, wait for the reply, and fill the form from it. */
  askChat(tabId: number, session: string): Promise<Res<{ summary?: FillSummary; rounds?: number; note?: string }>>;
}
