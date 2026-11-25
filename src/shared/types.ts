// Contracts shared by every part of lazyBoi. See PRD.md §4.

export const PROTOCOL_VERSION = 1 as const;

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "checkbox-group"
  | "richtext";

export interface FieldOption {
  value: string;
  label: string;
}

/** One fillable field, as described to the AI. */
export interface Field {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  placeholder?: string;
  /** Section the field belongs to, e.g. "Experience #1". */
  group?: string;
  /** Allowed choices for select / radio / multiselect / checkbox-group. */
  options?: FieldOption[];
  /** Non-binding suggestions (e.g. from a <datalist>). */
  suggestions?: string[];
  /** Expected value format for date-like fields, e.g. "YYYY-MM-DD". */
  format?: string;
  min?: string;
  max?: string;
}

export type SkipReason = "sensitive" | "file" | "unsupported";

export interface SkippedField {
  label: string;
  reason: SkipReason;
}

/** Extension → AI. */
export interface FormSchema {
  v: typeof PROTOCOL_VERSION;
  session: string;
  page: { title: string; url: string };
  fields: Field[];
  skipped: SkippedField[];
}

export type FieldValue = string | string[] | boolean;

/** AI → extension. */
export interface Reply {
  session?: string;
  values: Record<string, FieldValue>;
}

export type SessionStatus = "scanned" | "awaiting_reply" | "previewing" | "filled" | "expired";

export interface SessionRecord {
  id: string;
  tabId: number;
  url: string;
  title: string;
  schema: FormSchema;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
}

export const SESSION_TTL_MS = 30 * 60 * 1000;
