/**
 * Course-segment skeleton (audit 2026-10-02 P2-3: the heaviest route
 * segment — 49 courses x 7 subroutes — had no loading UI, so slow disk
 * reads rendered nothing then jumped). Approximates the course-shell
 * sidebar + content column without pretending to be real data.
 */
export default function CourseLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-6">
      <div className="hidden w-56 shrink-0 flex-col gap-2 md:flex" aria-hidden>
        {["w-24", "w-40", "w-36", "w-44", "w-32", "w-40", "w-28"].map((w, i) => (
          <div key={i} className={`h-5 animate-pulse rounded-md bg-muted motion-reduce:animate-none ${w}`} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3" aria-hidden>
        <div className="h-8 w-64 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-48 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted/50 motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    </div>
  );
}
