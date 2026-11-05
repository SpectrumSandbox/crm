"use client";

import * as React from "react";
import { cn, endOfDayWib, formatDate, fromDateInput, fromDateTimeInput, isDateInput, startOfDayWib, toDateInput, toDateTimeInput } from "@/lib/utils";
import { fieldClass, useFieldControl } from "./input";

export interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "min" | "max"> {
  /** ISO instant (or null / "" for empty) */
  value: string | null | undefined;
  /** ISO instant, or null when the field is cleared. Never throws on an empty or partial value. */
  onValueChange: (iso: string | null) => void;
  /** "date" (default) or "datetime" (date + time, read and shown in WIB) */
  mode?: "date" | "datetime";
  /**
   * For mode="date": the time of day stored for the picked day — "workday" 17:00 WIB (default, same as fromDateInput),
   * "start" 00:00 WIB (period starts) or "end" 23:59:59.999 WIB (inclusive period ends).
   */
  at?: "workday" | "start" | "end";
  /** earliest / latest allowed: ISO instant or "yyyy-mm-dd" */
  min?: string;
  max?: string;
  wrapperClassName?: string;
}

function bound(v: string | undefined, mode: "date" | "datetime") {
  if (!v) return undefined;
  if (isDateInput(v)) return mode === "date" ? v : `${v}T00:00`;
  return (mode === "date" ? toDateInput(v) : toDateTimeInput(v)) || undefined;
}

/**
 * Date (or date-time) field bound to an ISO value in WIB. Clearing the field reports null instead of crashing,
 * days are shown day-month-year (en-GB) rather than the US order, and the full date is in the tooltip.
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onValueChange, mode = "date", at = "workday", min, max, wrapperClassName, className, title, ...rest },
  ref,
) {
  const a11y = useFieldControl(rest);
  const zoneId = React.useId();
  const text = mode === "date" ? toDateInput(value || null) : toDateTimeInput(value || null);
  const toIso = (raw: string) => {
    if (mode === "datetime") return fromDateTimeInput(raw);
    return at === "start" ? startOfDayWib(raw) : at === "end" ? endOfDayWib(raw) : fromDateInput(raw);
  };
  const readable = value ? `${formatDate(value, mode === "date" ? "long" : "datetime")}${mode === "datetime" ? " WIB" : ""}` : undefined;

  const input = (
    <input
      ref={ref}
      type={mode === "date" ? "date" : "datetime-local"}
      lang="en-GB"
      {...rest}
      {...a11y}
      aria-describedby={[a11y["aria-describedby"], mode === "datetime" ? zoneId : undefined].filter(Boolean).join(" ") || undefined}
      title={title ?? readable}
      min={bound(min, mode)}
      max={bound(max, mode)}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        if (!raw) {
          onValueChange(null);
          return;
        }
        const iso = toIso(raw);
        // browsers only report complete values; anything unreadable is treated as "not set yet"
        onValueChange(iso || null);
      }}
      className={cn(fieldClass, "sg-num h-8 [color-scheme:dark]", className)}
    />
  );

  if (mode === "date") return wrapperClassName ? <span className={cn("block", wrapperClassName)}>{input}</span> : input;
  return (
    <span className={cn("flex items-center gap-1.5", wrapperClassName)}>
      {input}
      <span id={zoneId} className="shrink-0 text-2xs font-semibold text-sg-dim">
        WIB
      </span>
    </span>
  );
});
