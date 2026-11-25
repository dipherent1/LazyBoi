// Message shapes between popup, widget (content script), service worker and content script.
import type { FieldValue, FormSchema, SessionRecord, SessionStatus } from "./types";

export type PopupRequest =
  | { kind: "popup:getState"; tabId: number }
  | { kind: "popup:scan"; tabId: number }
  | { kind: "popup:markCopied"; session: string }
  | { kind: "popup:reply"; text: string; fallbackSession?: string };

/** Sent by the on-page widget; the sender's tab is the form or chat tab. */
export type WidgetRequest =
  | { kind: "w:scan" }
  | { kind: "w:copied"; session: string }
  | { kind: "w:fill" }
  | { kind: "w:reply"; text: string }
  | { kind: "w:latest" }
  | { kind: "w:queue"; text: string };

export type ContentRequest =
  | { kind: "lb:ping" }
  | { kind: "lb:scan"; session: string }
  | { kind: "lb:preview"; session: string; values: Record<string, FieldValue>; notes: string[] };

export type StatusMessage = { kind: "lb:status"; session: string; status: SessionStatus };

export type Ok<T = object> = { ok: true } & T;
export type Fail = { ok: false; error: string; code?: string };
export type Result<T = object> = Ok<T> | Fail;

export type GetStateResponse = Result<{ session: SessionRecord | null }>;
export type ScanResponse = Result<{ session: SessionRecord }>;
export type ReplyResponse = Result<{ session: string; tabId: number; switchedTab: boolean }>;
export type ContentScanResponse = Result<{ schema: FormSchema }>;
