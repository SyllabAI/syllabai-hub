import Link from "next/link";

/**
 * Branded 404 for every unmatched route and every notFound() call
 * (audit 2026-10-02 P2-3: the site is deep-link-heavy — ?spec= anchors,
 * 49 courses x 7 subroutes — so stale links were landing on Next's
 * stock unstyled 404 inside the shell).
 *
 * Rendered inside the root AppShell, so the header/switcher stay usable.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        404 · not found
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        This page doesn&apos;t exist
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        The link may be stale, or the course may have moved. Course pages live
        under <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">/courses/…</code>{" "}
        — the directory below lists everything that is real right now.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/courses"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Browse courses
        </Link>
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
