"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-segment error boundary (audit 2026-10-02 P2-3: a server throw —
 * malformed bundle, failed zod parse — used to render Next's default crash
 * screen). Rendered inside the root AppShell, so navigation survives.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // server logs get the stack via the request; keep the digest in console
    console.error("[route-error]", error.digest ?? "", error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        something broke
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        This view failed to load
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        It usually works — retrying fixes transient failures. If it keeps
        happening, the reference is{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
          {error.digest ?? "n/a"}
        </code>
        .
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
