"use client";

import { useEffect } from "react";
import "./globals.css";
import { users } from "@/lib/seed";

const REPORT_TO = users.find((u) => u.team === "Engineering" && /manager/i.test(u.title))?.email ?? users.find((u) => u.team === "Engineering")?.email ?? "";

/** Last-resort boundary: replaces the root layout when it (or something above every route) throws. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const subject = `Spectrum CRM fatal error${error.digest ? ` ${error.digest}` : ""}`;
  const body = [
    "What I was doing:",
    "",
    "",
    "— technical details —",
    `Page: ${typeof window !== "undefined" ? window.location.href : ""}`,
    `Error: ${error.message || error.name}`,
    `Digest: ${error.digest ?? "n/a (client-side error)"}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");
  const mailto = `mailto:${REPORT_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <html lang="en" className="dark">
      <head>
        <title>Something went wrong · Spectrum CRM</title>
      </head>
      <body>
        <main className="flex min-h-dvh items-center justify-center px-4 py-10">
          <section role="alert" aria-labelledby="fatal-title" className="w-full max-w-lg overflow-hidden rounded-xl border border-sg-line bg-sg-card">
            <div className="sg-spectrum-rule h-[2px]" aria-hidden />
            <div className="space-y-4 p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/spectrum-logo.png" alt="Spectrum Group" width={120} height={23} className="h-[23px] w-auto" />
              <div>
                <div className="sg-eyebrow">Fatal error</div>
                <h1 id="fatal-title" className="font-display text-xl font-extrabold text-sg-white">
                  Spectrum CRM couldn&apos;t load
                </h1>
                <p className="mt-1 text-sm text-sg-muted">The workspace stopped before it could render. Reloading usually fixes it; if not, send the details to engineering.</p>
              </div>
              <div className="rounded-lg border border-sg-line bg-sg-bg/60 p-3">
                <p className="break-words font-mono text-xs text-sg-text">{error.message || "Unknown error"}</p>
                <p className="mt-2 font-mono text-xs text-sg-dim">Reference: {error.digest ?? "client-side error"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => reset()}
                  className="inline-flex h-8 items-center rounded bg-sg-white px-3.5 text-sm font-semibold tracking-cta text-sg-bg hover:bg-sg-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70 focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex h-8 items-center rounded border border-sg-line-2 px-3.5 text-sm font-semibold tracking-cta text-sg-text hover:border-sg-white hover:text-sg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
                >
                  Reload
                </button>
                <a href={mailto} className="inline-flex h-8 items-center rounded border border-sg-line-2 px-3.5 text-sm font-semibold tracking-cta text-sg-text hover:border-sg-white hover:text-sg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70">
                  Report
                </a>
              </div>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
