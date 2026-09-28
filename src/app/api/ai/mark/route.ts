import { NextRequest } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

/**
 * POST /api/ai/mark — SME-style "Mark my answer".
 *
 * NOT AVAILABLE (ADR-029): core's Smart Mark needs core question IDs and
 * runs behind the κ-gated marking pipeline; the hub's SME corpus questions
 * carry corpus IDs that don't map yet. The self-mark flow in the question
 * player (mark scheme reveal + "How did you do?") is the honest path, and
 * GET reports { available: false } so players hide the AI affordance.
 */

const Body = z.object({
  problemMd: z.string().min(1).max(6000),
  solutionMd: z.string().min(1).max(6000),
  marks: z.number().int().min(1).max(20),
  answer: z.string().min(1).max(4000),
});

export async function GET() {
  return Response.json({ available: false });
}

export async function POST(req: NextRequest) {
  try {
    Body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  return Response.json(
    {
      error: "not_available",
      detail:
        "AI marking needs core-served questions — it arrives with the pilot's question bridge. Use the mark scheme and self-mark in the player meanwhile.",
    },
    { status: 501 },
  );
}
