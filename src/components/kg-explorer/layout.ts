/**
 * KGX layout — faithful port of the v75 "clustered suburbs" placement.
 *
 * The reference's visual signature is NOT a radial tree fanning arcs from the
 * center; it is clustered neighborhoods:
 *
 *   root at the center; level-1 clusters sit on fixed anchors around it (v75
 *   hard-codes four section quadrants on a wide ellipse — [390,220], [1090,220],
 *   [420,640], [1080,650] around a [750,420] subject);
 *
 *   level-2 members sit on a FULL local ellipse around their cluster anchor
 *   (v75 subAnchors: r=175, squash 118/175, order-indexed from the top);
 *
 *   level-3+ members sit on local multi-ring "flowers" around their parent
 *   (v75 makePointOffset: rings of 7, radius 74 + 26*ringIndex, alternating
 *   ±0.11 jitter) — deeper levels use tighter collars so nested clusters stay
 *   readable;
 *
 *   misconceptions always hug their parent in a tight collar (state overlay,
 *   not curriculum structure).
 *
 * Parentless trees (the history host) ring the same level-1 ellipse, since a
 * flat topic set reads best as one neighborhood around the canvas center.
 *
 * These positions are HOME anchors — the engine's relaxation simulation
 * (home spring + collision + edge springs) refines them at runtime, exactly
 * like the reference's simulationTick.
 */
import type { KGXGraph, KGXNode } from "./types";

export interface AnchoredNode extends KGXNode {
  homeX: number;
  homeY: number;
}

// v75 proportions (section anchors sit ±340..360 x, ±200..230 y from the subject)
const LEVEL1_RX = 410;
const LEVEL1_RY = 235;
// v75 subtopic ellipse
const LEVEL2_R = 175;
const LEVEL2_SQUASH = 118 / 175;
// v75 makePointOffset: 7 points per ring
const RING_PER = 7;

/** children grouped by parentId, preserving input order */
function childrenByParent(nodes: KGXNode[]): Map<string | null, KGXNode[]> {
  const map = new Map<string | null, KGXNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const arr = map.get(key);
    if (arr) arr.push(n);
    else map.set(key, [n]);
  }
  return map;
}

/**
 * v75 makePointOffset — local multi-ring placement around a parent: rings of
 * RING_PER members, radius growing by `step` per ring, angle indexed from the
 * top with an alternating ±0.11 jitter so neighbours don't align radially.
 */
function ringOffset(idx: number, count: number, base: number, step: number): [number, number] {
  const rings = Math.max(1, Math.ceil(count / RING_PER));
  const perRing = Math.ceil(count / rings);
  const ring = base + Math.floor(idx / perRing) * step;
  const local = idx % perRing;
  const angle = (local / Math.max(1, perRing)) * Math.PI * 2 - Math.PI / 2 + (idx % 2) * 0.11;
  return [Math.cos(angle) * ring, Math.sin(angle) * ring];
}

/**
 * Compute home anchors for the whole forest. A single root sits at the origin;
 * a parentless set (history lens) rings the level-1 ellipse instead.
 */
export function computeAnchors(graph: KGXGraph): AnchoredNode[] {
  const { nodes } = graph;
  const children = childrenByParent(nodes);
  const anchored = new Map<string, AnchoredNode>();

  const roots = children.get(null) ?? [];

  /**
   * Place `node` at (x, y) and recurse. `depth` is the node's own depth
   * (root = 0). Children are placed by the v75 rule for the parent's level:
   * depth 0 → level-1 ellipse anchors; depth 1 → full local ellipse;
   * depth ≥ 2 → local flower rings (tighter each level).
   */
  const place = (node: KGXNode, x: number, y: number, depth: number) => {
    anchored.set(node.id, { ...node, homeX: x, homeY: y });
    const kids = children.get(node.id) ?? [];
    if (!kids.length) return;

    if (depth === 0) {
      // level-1: cluster anchors on a wide ellipse around the root (v75's
      // section quadrants; generic for any cluster count, starting top-left)
      const n = Math.max(1, kids.length);
      kids.forEach((k, i) => {
        const a = -Math.PI * 0.75 + (i / n) * Math.PI * 2;
        place(k, x + Math.cos(a) * LEVEL1_RX, y + Math.sin(a) * LEVEL1_RY, 1);
      });
      return;
    }

    if (depth === 1) {
      // level-2: full local ellipse around the cluster anchor, order-indexed
      // from the top (v75 subAnchors) — big branches get a whole ring, not a
      // narrowing arc
      const n = Math.max(1, kids.length);
      kids.forEach((k, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        place(k, x + Math.cos(a) * LEVEL2_R, y + Math.sin(a) * LEVEL2_R * LEVEL2_SQUASH, 2);
      });
      return;
    }

    // depth ≥ 2: local flower rings around the parent (v75 spec-point
    // placement), with misconceptions always in a tight collar regardless of
    // their sibling set
    const base = depth === 2 ? 74 : 48; // v75 spec ring base / tighter collars deeper
    const step = depth === 2 ? 26 : 20;
    kids.forEach((k, i) => {
      if (k.type === "MISCONCEPTION") {
        // collar: small alternating angular + radial offsets so a cluster of
        // misconceptions forms a readable necklace instead of a line
        const jitter = ((i % 5) - 2) * 0.16;
        const kr = 40 + (i % 3) * 14;
        const a = (i / Math.max(1, kids.length)) * Math.PI * 2 - Math.PI / 2;
        anchored.set(k.id, {
          ...k,
          homeX: x + Math.cos(a + jitter) * kr,
          homeY: y + Math.sin(a + jitter) * kr * 0.8,
        });
        return;
      }
      const [ox, oy] = ringOffset(i, kids.length, base, step);
      place(k, x + ox, y + oy * 0.86, depth + 1);
    });
  };

  if (roots.length === 1) {
    place(roots[0], 0, 0, 0);
  } else if (roots.length > 1) {
    // parentless set: one shared neighborhood — roots ring the level-1
    // ellipse (the old horizontal line spanned 700px per root and pushed the
    // camera absurdly wide for flat topic sets)
    const n = roots.length;
    roots.forEach((r, i) => {
      const a = -Math.PI * 0.75 + (i / n) * Math.PI * 2;
      place(r, Math.cos(a) * LEVEL1_RX, Math.sin(a) * LEVEL1_RY, 1);
    });
  }

  // orphan nodes (parentId pointing at a missing node): ring the origin so
  // they are never rendered at (0,0) stacked
  let orphanIdx = 0;
  for (const n of nodes) {
    if (anchored.has(n.id)) continue;
    const ang = (orphanIdx / Math.max(1, nodes.length)) * Math.PI * 2;
    anchored.set(n.id, {
      ...n,
      homeX: Math.cos(ang) * 520,
      homeY: Math.sin(ang) * 420,
    });
    orphanIdx += 1;
  }

  return nodes.map((n) => anchored.get(n.id)!);
}
