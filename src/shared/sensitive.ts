// Detection of fields lazyBoi must never read or fill (PRD S5).

const SENSITIVE_AUTOCOMPLETE = /^(cc-.+|current-password|new-password|one-time-code)$/;

const SENSITIVE_TEXT = new RegExp(
  [
    "pass ?(word|code|phrase)",
    "pwd",
    "pin",
    "cvv2?",
    "cvc2?",
    "csc",
    "security code",
    "card (number|num|no)",
    "credit card",
    "debit card",
    "cc (num|number)",
    "ccnum",
    "expir(y|ation) (date|month|year)",
    "ssn",
    "social security",
    "sin",
    "social insurance",
    "passport",
    "national id",
    "tax id",
    "tin",
    "bank account",
    "account number",
    "acct (number|num|no)",
    "routing",
    "iban",
    "swift",
    "bic",
    "sort code",
    "otp",
    "one time (code|password)",
    "verification code",
    "2fa",
  ]
    .map((p) => `\\b${p}\\b`)
    .join("|"),
  "i",
);

/** Lowercase, split camelCase and separators so "cardNumber" / "card_number" match "card number". */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.:/[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface SensitivityInput {
  type?: string;
  autocomplete?: string;
  texts: (string | null | undefined)[];
}

export function isSensitive({ type, autocomplete, texts }: SensitivityInput): boolean {
  if (type?.toLowerCase() === "password") return true;
  if (autocomplete) {
    const tokens = autocomplete.toLowerCase().split(/\s+/);
    if (tokens.some((t) => SENSITIVE_AUTOCOMPLETE.test(t))) return true;
  }
  return texts.some((t) => !!t && SENSITIVE_TEXT.test(normalizeForMatch(t)));
}

/** Used to refuse sensitive values even if a field slipped through detection. */
export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
