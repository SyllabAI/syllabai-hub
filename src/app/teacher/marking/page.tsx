import type { Metadata } from "next";
import { MarkingConsoleClient } from "./marking-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marking review — SyllabAI Hub teacher workspace",
  description:
    "The teacher marking console: the Smart Mark review queue, human-mark overrides and the κ agreement gate — live cohort data from the SyllabAI backend.",
};

export default function MarkingPage() {
  return <MarkingConsoleClient />;
}
