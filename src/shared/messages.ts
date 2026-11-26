// Message shapes between the on-page widget (content script), the service worker and the content script.
import type { FieldValue, FillSummary, FormSchema, SessionRecord } from "./types";

/** From the on-page widget; the sender's tab is the form or chat tab. */
export type WidgetRequest =
  | { kind: "w:scan" }
  | { kind: "w:copied"; session: string }
  | { kind: "w:fill" }
  | { kind: "w:reply"; text: string }
  | { kind: "w:latest" }
  | { kind: "w:queue"; text: string }
  | { kind: "w:undo" };

/** To a tab's content script. */
export type ContentRequest =
  | { kind: "lb:ping" }
  | { kind: "lb:scan"; session: string }
  | { kind: "lb:fill"; session: string; values: Record<string, FieldValue> }
  | { kind: "lb:undo" };

export type StatusMessage = { kind: "lb:status"; session: string; status: "filled" };

export type Ok<T = object> = { ok: true } & T;
export type Fail = { ok: false; error: string; code?: string };
export type Result<T = object> = Ok<T> | Fail;

export type ScanResponse = Result<{ session: SessionRecord }>;
export type ReplyResponse = Result<{ session: string; tabId: number; switchedTab: boolean; summary?: FillSummary }>;
export type ContentScanResponse = Result<{ schema: FormSchema }>;
