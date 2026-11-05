"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded border border-sg-line bg-sg-bg/60 px-2.5 text-sm text-sg-text placeholder:text-sg-dim transition-colors duration-150 hover:border-sg-line-2 focus:border-sg-white/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white/40 disabled:opacity-50 aria-[invalid=true]:border-soft-red/70 aria-[invalid=true]:focus:border-soft-red";

/** Shared field chrome, for custom controls that should look like Input (MoneyInput, DateInput, Combobox). */
export const fieldClass = field;

/* ───────────── Field ↔ control association ─────────────
 * <Field label="Amount"><Input …/></Field> ties the label to the control (htmlFor/id) and wires hint / error text via
 * aria-describedby, without the page passing ids. The first control inside a Field claims its id; any further controls
 * keep their own. */

interface FieldCtx {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
  claim: (token: string) => boolean;
}
const FieldContext = React.createContext<FieldCtx | null>(null);

/**
 * For controls: returns the id / aria props a surrounding <Field> wants this control to carry. Own props win.
 * Spread the result onto the focusable element.
 */
export function useFieldControl(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: React.AriaAttributes["aria-invalid"]; required?: boolean }) {
  const ctx = React.useContext(FieldContext);
  const token = React.useId();
  const owns = !!ctx && !props.id && ctx.claim(token);
  if (!ctx || !owns) return { id: props.id, "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"], required: props.required };
  const describedBy = [props["aria-describedby"], ctx.describedBy].filter(Boolean).join(" ") || undefined;
  return {
    id: ctx.id,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (ctx.invalid ? true : undefined),
    required: props.required ?? (ctx.required || undefined),
  };
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => {
  const a11y = useFieldControl(props);
  return <input ref={ref} {...props} {...a11y} className={cn(field, "h-8", className)} />;
});
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => {
  const a11y = useFieldControl(props);
  return <textarea ref={ref} {...props} {...a11y} className={cn(field, "min-h-[84px] resize-y py-2 leading-relaxed", className)} />;
});
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }>(
  ({ className, wrapperClassName, children, ...props }, ref) => {
    const a11y = useFieldControl(props);
    return (
      <span className={cn("relative block", wrapperClassName)}>
        <select ref={ref} {...props} {...a11y} className={cn(field, "h-8 cursor-pointer appearance-none pr-7 [&>option]:bg-sg-card", className)}>
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-muted" />
      </span>
    );
  },
);
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim", className)} {...props} />;
}

const NATIVE_CONTROLS = new Set(["input", "select", "textarea"]);

/**
 * Labelled form field. The label is programmatically tied to the first control inside (Input, Select, Textarea,
 * MoneyInput, DateInput, Combobox, or a plain <input>/<select>/<textarea> passed directly); `hint` and `error` are
 * announced with it. `required` adds a visible marker and sets `required` on the control.
 */
export function Field({
  label,
  children,
  className,
  hint,
  error,
  required,
  id: idProp,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  hint?: React.ReactNode;
  /** validation message; marks the control aria-invalid */
  error?: React.ReactNode;
  required?: boolean;
  /** id for the control (defaults to a generated one) */
  id?: string;
}) {
  const auto = React.useId();
  const id = idProp ?? `f${auto.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const owner = React.useRef<string | null>(null);
  const ctx = React.useMemo<FieldCtx>(
    () => ({
      id,
      describedBy,
      invalid: !!error,
      required: !!required,
      claim: (token) => {
        if (owner.current === null) owner.current = token;
        return owner.current === token;
      },
    }),
    [id, describedBy, error, required],
  );

  // a plain <input>/<select>/<textarea> passed directly gets the id too
  let content = children;
  if (React.isValidElement(children) && typeof children.type === "string" && NATIVE_CONTROLS.has(children.type)) {
    const p = children.props as Record<string, unknown>;
    if (!p.id && (owner.current === null || owner.current === "native")) {
      owner.current = "native";
      content = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        "aria-describedby": [p["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
        "aria-invalid": p["aria-invalid"] ?? (error ? true : undefined),
        required: p.required ?? (required || undefined),
      });
    }
  }

  return (
    <div className={className}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <>
            <span aria-hidden className="ml-0.5 text-soft-red">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </Label>
      <FieldContext.Provider value={ctx}>{content}</FieldContext.Provider>
      {error ? (
        <p id={errorId} className="mt-1 text-2xs font-medium text-soft-red">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="mt-1 text-2xs text-sg-dim">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
