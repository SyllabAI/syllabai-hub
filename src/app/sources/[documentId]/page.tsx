import type { Metadata } from "next";
import { Suspense } from "react";
import { SourceReader } from "./source-reader";

export const metadata: Metadata = {
  title: "Source",
  description:
    "The verbatim source a citation points at — the question paper, mark scheme or specification page behind a tutor or assistant answer.",
};

/**
 * F-022 — the in-app source reader: the drill-in target for document-backed
 * tutor/CLA citations (/sources/{row}?page=N, mapped by the citation bridge).
 * The client fetches core's learner-readable citation route with the signed-
 * in learner's token — a plain <a> navigation can never carry the Bearer
 * header, which is why this is a hub page and not a core deep link. Core
 * enforces the corpus law server-side (a document nothing serves is an
 * honest 404); this surface renders exactly what that route returns — no
 * client-side content decisions.
 */
export default function SourcePage() {
  return (
    <Suspense fallback={null}>
      <SourceReader />
    </Suspense>
  );
}
