import "server-only";

/**
 * Citation mapping — core DTOs (TutorCitation/ClaCitation:
 * {index,label,sourceType,documentId,page,nodeId,deepLink}) → the hub's
 * client contract (contracts.ts TutorCitation:
 * {index,label,kind,ref,specPointCode,url,score}).
 *
 * url: core's deepLink targets core REST paths, not hub routes — until the
 * per-surface deep-link bridge lands, chips render as informative labels
 * (the client renders `href={url ?? "#"}`), so we pass null rather than a
 * link that 404s inside the app.
 */
export interface CoreCitation {
  index?: number;
  label?: string | null;
  sourceType?: string | null;
  documentId?: string | null;
  page?: number | null;
  nodeId?: string | null;
  deepLink?: string | null;
}

const KINDS = new Set(["REVISION_NOTE", "QUESTION_PART", "SPEC_POINT", "CONCEPT"]);

export function mapCitation(c: CoreCitation, i: number) {
  const kind =
    typeof c.sourceType === "string" && KINDS.has(c.sourceType) ? c.sourceType : "SPEC_POINT";
  return {
    index: typeof c.index === "number" ? c.index : i + 1,
    label: typeof c.label === "string" && c.label.length > 0 ? c.label : "Source",
    kind: kind as "REVISION_NOTE" | "QUESTION_PART" | "SPEC_POINT" | "CONCEPT",
    ref: c.documentId ?? c.nodeId ?? c.label ?? "core",
    specPointCode: null,
    url: null,
    score: 1,
  };
}
