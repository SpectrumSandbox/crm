"use client";

import * as React from "react";
import { cn, formatIDR, groupIDR, parseIDR } from "@/lib/utils";
import { fieldClass, useFieldControl } from "./input";

export interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "min" | "max"> {
  /** whole rupiah; null / undefined = empty */
  value: number | null | undefined;
  /** called with the parsed amount, or null when the field is empty or can't be read as an amount */
  onValueChange: (value: number | null) => void;
  allowNegative?: boolean;
  min?: number;
  max?: number;
  /** show the compact reading ("≈ Rp 7,2 M") inside the field while typing (default true) */
  preview?: boolean;
  wrapperClassName?: string;
}

const PLAIN = /^-?[\d.\s]*$/;

/** Text for the caret after reformatting: the position right after the `digits`-th digit. */
function caretAfterDigits(text: string, digits: number) {
  if (digits <= 0) return text.startsWith("-") ? 1 : 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i]!)) seen++;
    if (seen === digits) return i + 1;
  }
  return text.length;
}

function validate(n: number | null, text: string, allowNegative: boolean, min?: number, max?: number) {
  if (!text.trim()) return null;
  if (n === null) return "Type an amount like 7.200.000.000, 7,2 M or 720 jt";
  if (n < 0 && !allowNegative) return "The amount can't be negative";
  if (min !== undefined && n < min) return `At least ${formatIDR(min, "full")}`;
  if (max !== undefined && n > max) return `At most ${formatIDR(max, "full")}`;
  return null;
}

/**
 * Rupiah amount field. Digits are grouped as you type ("7.200.000.000"); Indonesian and English short forms are read
 * too — "7,2 M" (miliar), "720 jt", "1,5 miliar", "7.2B" — and normalised on blur. The compact reading is shown at the
 * right so a missing zero is obvious. Invalid input is flagged (aria-invalid + message) and reported as null.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onValueChange, allowNegative = false, min, max, preview = true, wrapperClassName, className, onBlur, onFocus, placeholder = "0", ...rest },
  ref,
) {
  const a11y = useFieldControl(rest);
  const local = React.useRef<HTMLInputElement | null>(null);
  const setRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      local.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const [text, setText] = React.useState(() => (value === null || value === undefined || !Number.isFinite(value) ? "" : groupIDR(value)));
  const [focused, setFocused] = React.useState(false);
  const emitted = React.useRef<number | null | undefined>(value);
  const caret = React.useRef<number | null>(null);
  const msgId = React.useId();

  // follow outside changes (reset, prefill) but not our own echo
  React.useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setText(value === null || value === undefined || !Number.isFinite(value) ? "" : groupIDR(value));
  }, [value]);

  React.useLayoutEffect(() => {
    if (caret.current === null || !local.current) return;
    const at = caret.current;
    caret.current = null;
    try {
      local.current.setSelectionRange(at, at);
    } catch {
      /* some input modes don't support selection */
    }
  }, [text]);

  const parsed = parseIDR(text);
  const problem = validate(parsed, text, allowNegative, min, max);
  // don't flag half-typed input ("7,2 j") while the person is still typing
  const error = focused ? null : problem;

  const emit = (next: number | null) => {
    emitted.current = next;
    onValueChange(next);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;
    if (PLAIN.test(raw) && /\d/.test(raw)) {
      // plain digits (with or without dots): regroup live and keep the caret after the same digit
      const pos = e.target.selectionStart ?? raw.length;
      let digitsBefore = raw.slice(0, pos).replace(/\D/g, "").length;
      const negative = allowNegative && raw.trim().startsWith("-");
      let all = raw.replace(/\D/g, "");
      // backspace over a "." separator: delete the digit in front of it instead of doing nothing
      if (all === text.replace(/\D/g, "") && raw.length < text.length && digitsBefore > 0) {
        all = all.slice(0, digitsBefore - 1) + all.slice(digitsBefore);
        digitsBefore -= 1;
      }
      const digits = all.replace(/^0+(?=\d)/, "");
      raw = digits.length > 15 ? raw : digits ? `${negative ? "-" : ""}${groupIDR(Number(digits))}` : "";
      caret.current = caretAfterDigits(raw, digitsBefore);
    }
    setText(raw);
    const n = parseIDR(raw);
    emit(raw.trim() && validate(n, raw, allowNegative, min, max) === null ? n : null);
  };

  const compact = parsed !== null && !problem ? formatIDR(parsed) : null;
  const showPreview = preview && focused && compact !== null && Math.abs(parsed ?? 0) >= 1_000;

  return (
    <span className={cn("relative block", wrapperClassName)}>
      <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-sg-dim">
        Rp
      </span>
      <input
        ref={setRef}
        type="text"
        inputMode={allowNegative ? "text" : "decimal"}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        {...rest}
        {...a11y}
        aria-invalid={error ? true : a11y["aria-invalid"]}
        aria-describedby={[a11y["aria-describedby"], error ? msgId : undefined].filter(Boolean).join(" ") || undefined}
        value={text}
        onChange={onChange}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          if (parsed !== null && !problem) setText(groupIDR(parsed));
          onBlur?.(e);
        }}
        style={showPreview ? { paddingRight: `${(compact?.length ?? 0) * 0.62 + 1.4}em` } : undefined}
        className={cn(fieldClass, "sg-num h-8 pl-8", className)}
      />
      {showPreview ? (
        <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-2xs text-sg-dim">
          ≈ {compact}
        </span>
      ) : null}
      {error ? (
        <span id={msgId} role="status" className="mt-1 block text-2xs font-medium text-soft-red">
          {error}
        </span>
      ) : null}
    </span>
  );
});
