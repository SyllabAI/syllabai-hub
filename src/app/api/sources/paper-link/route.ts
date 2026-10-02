import { NextRequest } from "next/server";
import { z } from "zod";
import { paperViewerLink } from "@/lib/paper-link";

/**
 * GET /api/sources/paper-link — the F-022 tranche 2 join resolver: the
 * /sources reader holds core's paper identity for a cited document and asks
 * THIS repo (server-side, where the corpus index lives) which of its own
 * past-paper viewer URLs — if any — is the real paper PDF behind the
 * citation. Answers { href: string | null }; a null is a no-match, never a
 * guess.
 *
 * Unauthenticated by design: it resolves PUBLIC corpus addressing (the
 * past-papers surfaces are public demo data) and holds no learner data. The
 * parameters are zod-bounded; the matcher itself is pure in-memory index
 * work — no upstream calls, nothing to rate-limit.
 */
const Query = z.object({
  paperCode: z.string().min(1).max(40),
  sessionLabel: z.string().min(1).max(80),
  role: z.enum(["QP", "MS"]),
  course: z.string().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).max(2000).optional(),
});

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const parsed = Query.safeParse({
    paperCode: q.get("paperCode") ?? undefined,
    sessionLabel: q.get("sessionLabel") ?? undefined,
    role: q.get("role") ?? undefined,
    course: q.get("course") ?? undefined,
    page: q.get("page") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "invalid_query" }, { status: 400 });
  }
  const { paperCode, sessionLabel, role, course, page } = parsed.data;
  const href = await paperViewerLink({ paperCode, sessionLabel, role, page }, course ?? null);
  return Response.json(
    { href },
    { headers: { "Cache-Control": "no-store" } },
  );
}
