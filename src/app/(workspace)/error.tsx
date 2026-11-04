"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Mail, RotateCcw, TriangleAlert } from "lucide-react";
import { users } from "@/lib/seed";
import { Button } from "@/components/ui/button";
import { SpectrumRule } from "@/components/ui/misc";

/** Errors go to the engineering manager in the workspace directory. */
const REPORT_TO = users.find((u) => u.team === "Engineering" && /manager/i.test(u.title))?.email ?? users.find((u) => u.team === "Engineering")?.email ?? "";

function reportHref(error: Error & { digest?: string }) {
  const where = typeof window !== "undefined" ? window.location.href : "";
  const body = [
    "What I was doing:",
    "",
    "",
    "— technical details —",
    `Page: ${where}`,
    `Error: ${error.message || error.name}`,
    `Digest: ${error.digest ?? "n/a (client-side error)"}`,
    `Time: ${new Date().toISOString()}`,
    `Browser: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
  ].join("\n");
  const subject = `Spectrum CRM error${error.digest ? ` ${error.digest}` : ""}`;
  return `mailto:${REPORT_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    document.title = "Something went wrong · Spectrum CRM";
  }, [error]);

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-10 sm:py-16">
      <section role="alert" aria-labelledby="error-title" className="w-full max-w-lg overflow-hidden rounded-xl border border-sg-line bg-sg-card">
        <SpectrumRule className="h-[2px]" />
        <div className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-soft-red/15 text-soft-red">
              <TriangleAlert className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="sg-eyebrow">Error</div>
              <h1 id="error-title" className="font-display text-xl font-extrabold text-sg-white">
                This page hit a problem
              </h1>
              <p className="mt-1 text-sm text-sg-muted">Your data is safe — nothing was saved half-way. Try again, or send the details below to engineering.</p>
            </div>
          </div>

          <div className="rounded-lg border border-sg-line bg-sg-bg/60 p-3">
            <div className="sg-eyebrow mb-1">Message</div>
            <p className="break-words font-mono text-xs text-sg-text">{error.message || "Unknown error"}</p>
            <div className="sg-eyebrow mb-1 mt-3">Reference</div>
            <p className="sg-num font-mono text-xs text-sg-muted">{error.digest ?? "client-side error (no server digest)"}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => reset()}>
              <RotateCcw /> Try again
            </Button>
            <a href={reportHref(error)} className="inline-flex h-8 items-center gap-1.5 rounded border border-sg-line-2 px-3.5 text-sm font-semibold tracking-cta text-sg-text transition-colors hover:border-sg-white hover:text-sg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70 [&_svg]:size-4">
              <Mail aria-hidden /> Report
            </a>
            <Link href="/home" className="ml-auto rounded text-sm text-sg-dim hover:text-sg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70">
              Go to Home
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
