# Design Audit — Candy Shop & Chat App Plum themes

**Date:** 2026-09-29 · **Auditor role:** frontend design specialist · **Repo state:** `449b520` (main)
**Scope:** the two newest hub themes (`candy-shop`, `chat-app-plum`) against their source specs
(`refs/candy-shop-design-system.md` §1–16, `refs/chat-app-plum-design-system.md` §1–16), across
light + dark, static CSS and live render (:3199 standalone build).

**Method**

1. Full re-read of both specs → 40+ point checklist per theme (palette, contrast ledger, radius
   ladder, shadows, motion, type voices, per-component laws §10, application patterns §12, a11y §13).
2. Static diff of `globals.css` theme blocks + authored layers, and of every UI slot's shipped
   geometry (`button/badge/card/input/alert/toast/popover/dropdown/select/dialog/tooltip/sheet`).
3. Computed WCAG 2.1 ledger (script: `scripts/contrast_audit.py`) — 84 pairs incl. alpha-composited
   chip/wash backgrounds and 1.4.11 non-text checks.
4. Live walkthrough (agent-browser): landing, /courses, course hub, revision notes × both themes ×
   both modes; computed-style probes on buttons/cards/h1/tabs/course-nav/dropdown.

---

## Verdict

| | Candy Shop | Chat App Plum |
|---|---|---|
| Token fidelity (colors, shadows, radii, fonts) | **10/10** — every raw value byte-matches the spec; spec §3.3 ledger reproduced to the decimal (14.2/16.4/6.3/4.6/3.6) | **10/10** — same; ledger exact (15.4/17.4/6.7/5.3/**6.0**); the no-caveat white-on-violet win holds in both modes |
| Component signatures | 8.5/10 — tabs/chips/buttons/shadows on-spec; **course-nav active recipe missing**; menus one rung round | 9/10 — tabs/chips/buttons/§10.11 nav recipe all on-spec; menus one rung round |
| Accessibility | 7/10 — **P1: raw cherry as 12–14px text** in inherited markup (2.7–3.1:1); dark hover 2.93:1 | 8.5/10 — **P1: raw violet as 12–14px text in dark** (3.09:1); dark study chip 0.18 shy |
| Inheritance safety (SME/QG untouched) | ✅ all selectors theme-scoped | ✅ all selectors theme-scoped |

**Both token ports are faithful; every defect found lives in the seam between the specs and
SME-inherited hub markup (`text-primary`, toast hardcodes, shared slot geometry) — not in the
ported design systems themselves.**

---

## Findings

Severity: **P1** = WCAG/spec law broken on a persistent element · **P2** = spec violation with
user-visible impact or a landed landmine · **P3** = polish/nit. Fixes are authored-layer-only;
no component files need to change.

### F1 · P1 · candy — raw cherry as small text (accent-ink law bypassed)

SME-inherited markup uses `text-primary` for small text; under candy, `--primary` = raw cherry
`#FF2D6E`. The candy spec is explicit: *"for small cherry text switch to `--accent-ink`"* (§3.4,
§3.2 derivation). Measured on live probes:

| Element | Measured | Verdict |
|---|---|---|
| Course-nav **active label** (14px) | cherry on cherry-10% wash = **2.73:1** | FAIL |
| Breadcrumb active crumb "Edexcel" (14px) | cherry on bubblegum = **3.11:1** | FAIL |
| Icon chips (`bg-primary/10 text-primary`) | 3.11:1 | FAIL (icons pass 1.4.11 at 3.11, text does not) |

QG and plum both override the course-nav active recipe (surface + hairline + spine); candy never
got one, so it inherits SME's wash+`text-primary` recipe. Note: demoting the label to accent-ink
on the *wash* only reaches 4.07:1 — the correct fix is the recipe the sibling themes already use.

**Fix (authored layer):**
```css
/* cherry-as-text demotion (crumbs, icon chips, text-primary links) */
[data-theme="candy-shop"] .text-primary { color: var(--accent-ink); }
/* course-nav active: the sanctioned recipe — surface + hairline + cherry spine */
[data-theme="candy-shop"] a.course-nav-item[aria-current="page"] {
  background: var(--surface); color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--line); position: relative;
}
[data-theme="candy-shop"] a.course-nav-item[aria-current="page"]::before {
  content: ""; position: absolute; left: -6px; top: 7px; bottom: 7px;
  width: 3px; border-radius: 2px; background: var(--cherry);
}
```
(ink on wash = 12.50:1; accent-ink on bubblegum/white = 4.63/5.35 ✓). Cherry icons in dark
already pass (5.3); demoting to accent-ink `#FF5C8D` (6.46) in dark is recommended for voice
consistency but not required.

### F2 · P1 · plum — raw violet as small text in dark (§3.2 split bypassed)

Same seam, dark side. In plum dark, `--primary` stays `#7B44C7` (correct for fills), but
`text-primary` usages inherit it as *text*: live probe found **"All topics" filter links (12px)**,
resource links (14px) and icons rendering violet on `#161021` = **3.09:1** — below AA 4.5 for
text. The spec's entire `--accent-ink` derivation exists for this case (§3.2: *"dark text duty
shifts to `#A678EE`"*). Light mode is fine (5.32:1).

**Fix (authored layer):**
```css
[data-theme="chat-app-plum"].dark .text-primary { color: var(--accent-ink); } /* 5.79:1 */
```

### F3 · P2 · both — one-accent budget: two same-route CTAs per landing screen

Landing viewport shows header **"START STUDYING"** (accent fill) *and* hero **"OPEN MY
DASHBOARD"** (accent fill), both linking `/dashboard`, plus the `bg-primary` logo mark.
Candy §12.1: *"exactly one may be a call to action"*; §11 gives the hero the single accent and
§10.14 gives the navbar CTA a home — they collide here. Plum §12.1 identical.

**Fix (pick one, both themes):** hero CTA → `inverse` variant (ink fill / bg text — §10.1's own
demotion path, very on-brand for candy), or suppress the header CTA on marketing routes. Logo
mark is brand identity, arguably exempt, but counts toward the visual total.

### F4 · P2 · both — floating slots one rung off the spec ladder

The authored layers pin the utility ladder and inputs/badges, but shadcn ships fixed classes the
pins don't reach:

| Slot | Ships | Spec assigns |
|---|---|---|
| popover / dropdown-menu / select-content (rounded-md) | 24px / 18px | `--radius-sm` **14 / 10** |
| tooltip-content | 24px / 18px | 14 / 10 |
| alert (rounded-lg) | 40px / 28px | 14 / 10 |
| sheet-content (rounded-md) | 24px / 18px | `--radius-lg` 40 / 28 |

Inner items are correct (`dropdown-menu-item` = rounded-sm ✓). Impact: menus read rounder/
blobbier than spec; alerts lose their border-led crispness. **Fix:** slot-radius overrides in
each authored layer (same pattern as the existing input/select pin), ~6 lines per theme.

### F5 · P2 · both (hub-wide, pre-existing) — destructive toast text is a landmine

`--destructive-foreground` is **defined nowhere**; `toast.tsx` destructive variant =
`bg-destructive text-destructive-foreground` (→ inherits page ink) plus hardcoded
`text-red-300 / red-50 / red-400 / red-600` on the close button. No call site currently fires a
destructive toast (both `useToast` sites use the default variant), so this is latent — but the
moment one fires: plum light = **1.00:1** (plum-on-plum, invisible title), candy light =
**3.07:1** title + red-300 close at **2.82:1**, and a raw Tailwind red appears in a system that
owns no red (candy §14 *"never introduce a second red"*, plum has none at all).

**Fix:** define `--destructive-foreground` per theme (candy both modes `#FFFFFF` → 5.35/7.92;
plum light `#FFFFFF` → 17.4, plum dark `#23132E` on the `#C9B7E4` text voice ≈ 9.6) and extend
the authored destructive-toast neutralization (plum already has the dark half) to cover light
mode + candy, replacing the red-300 close with `--accent-ink`/`--bg` per theme.

### F6 · P2 · candy — dark hover fill drops below the sanctioned floor

Dark hover `#FF5C8D` + white label = **2.93:1** — *worse* than the already-documented 3.59 base
exception, and the authored layer points **destructive** hover at the same token in dark. The
spec's own `--accent-hover` dark value causes this (spec-inherited), but the destructive:hover
mapping is port-authored. Hover is transient at 150ms with an 800-weight label — mitigated, not
gone.

**Fix:** leave primary hover as the documented spec tension; point candy dark destructive hover
at a deepened cherry (e.g. hold `#E61F5F`, 7.92:1 with the `/60` composite) instead of `#FF5C8D`.

### F7 · P3 · plum — dark study chip 0.18 shy of AA

`#A678EE` on violet-22%-over-card = **4.32:1** (caption-size text needs 4.5). Fix: deepen wash to
`0.28` (≈4.6:1) or lighten text to `#B48BEA`. One line.

### F8 · P3 · candy — Fraunces voice coverage partial

`--app-font-display` reaches `h1` (via `@layer base`) and explicit `font-display` spans — the
landing/course h1s are genuinely Fraunces ✓ — but content `h2/h3` render Nunito, while the spec
assigns Fraunces to h1–h3 (and the `opsz 144` display cut is unset). Fix if desired:
theme-scoped `h2, h3 { font-family: var(--app-font-display) }`.

### F9 · P3 · both — spec micro-details not ported

Candy: Lucide `stroke-width: 2.25` (chunky candy hand) not applied (global 2). Plum: `tnum` on
tick-y figures (timestamps/counters) not wired theme-side. Both are one-liners if wanted; plum's
matters most on any live counter UI.

### F10 · P3 · both — selected dropdown items not in the accent-ink voice

Spec §10.9: selected menu item = `--accent-ink` text + trailing check. Hub ships ink text + ink
check (shadcn default). Cosmetic; can be added to the authored layers alongside F4.

---

## Judgement calls formally assessed (accepted)

- **Button label size kept at component size** (spec label is 0.72rem/800): accepted — density
  protection in dense headers; uppercase + weight + tracking carry the voice. Both themes.
- **Status colors converged into the owning family** (candy success=mulberry, warn=deepened
  cherry; plum success=violet, warn=deepened lavender-violet): accepted — both specs own no
  green/amber, and the hub never encodes state by hue alone (labels always accompany).
- **Plum dark destructive split** (text voice `#C9B7E4` vs filled slots `#3B2A52`): accepted and
  *correct* — filled white-label slots at 12.81:1, text voice at 10.07:1.
- **Candy destructive = spec §13 mitigation 3** (`#D11450` light / `#E61F5F` dark): works —
  5.35:1 light, 7.92:1 dark (via the `/60` composite over card).
- **`--line` hairlines at 1.44–1.69:1**: spec-inherited values; decorative separators are exempt
  from 1.4.11, and *functional* borders (inputs) use `--line-strong`, which passes 1.4.11 in all
  four theme-modes (3.77–4.36:1).
- **`--ink-faint`/`--ink-faintest`**: defined but unused for text (only `--chart-5` in plum);
  no raw-mulberry/lavender-as-text risk exists in the alias contract itself.
- **Sonner selectors in the authored layers**: dead coverage (hub mounts the radix Toaster);
  harmless.

## Compliance highlights (what passed)

- Ink-&-paper swaps exact (`#1E0A16` / `#161021` plum-blacks, never `#000`); accent fills
  byte-identical across modes (`#FF2D6E`, `#7B44C7`) with hover-toward-viewer in both.
- Shadow system exact: sanctioned `--shadow-pop`/`--shadow-overlay` values byte-match, static
  shadows zeroed (live-probed), floating layers re-shadowed, dark glows correct
  (`rgba(255,45,110,.18)`/`rgba(123,68,199,.25)` — live-probed on buttons).
- Radius ladders pinned and live-verified: candy buttons 24px / cards 40px / inputs 14px /
  badges pill; plum buttons 18px / cards 28px / inputs 10px / badges pill; small controls
  exempt as specified.
- Fonts at spec weights (Fraunces 600/700, Nunito 400–800, Inter 400–700), live-probed
  (h1 = Fraunces / Inter; buttons uppercase 800/600).
- All 84 computed pairs in the alias contract pass AA except the spec's own documented
  exceptions (candy white-on-cherry 3.59, its dark hover, F7's 0.18 chip shortfall).
- Tabs signature (accent spine + accent-ink active text), chips (owned-hue pill trio, all AA),
  plum §10.11 course-nav recipe — verified live in both modes.
- SME/QG regression: clean (theme-scoped selectors; SME probe byte-identical to pre-theme).

## Recommended fix batch (one commit, authored layers only)

1. F1 candy: `text-primary` demotion + course-nav active recipe (~14 lines).
2. F2 plum: dark `text-primary` demotion (1 line).
3. F4+F10: slot-radius pins for popover/dropdown/select-content/tooltip/alert/sheet + selected
   item accent-ink (~14 lines across both themes).
4. F5: define `--destructive-foreground` ×4 + finish destructive-toast neutralization (~12 lines).
5. F6: candy dark destructive hover → deepened cherry (1 line).
6. F3: demote one landing CTA to `inverse` (1 className).
7. F7: plum dark study-chip wash 0.28 (1 value).

Total ≈ 45 authored-layer lines; no component files; SME/QG untouched by construction.

## Addendum — fix batch as applied (same day)

The batch above shipped with two execution-time corrections, verified against the ledger
(`scripts/contrast_audit.py`, POST-FIX section — 29/29 pairs pass):

- **F7 took the report's alternate branch.** Deepening the wash to 0.28 LOWERS contrast, not
  raises it: raw violet is *lighter* than the dark card, so a stronger wash lightens the chip
  background (recomputed: 4.32 → 4.09:1). The applied fix lightens the chip text to `#B48BEA`
  on the unchanged 0.22 wash — **5.17:1**.
- **m1 (tooltips render accent) joined the batch.** Flagged in the first audit pass but dropped
  from the final findings list; both specs mandate inverse tooltips (ink fill / paper text), and
  the inherited `bg-primary` fill put 12px white labels on raw cherry (3.59:1). Fixed in both
  themes' authored layers (~8 lines): `tooltip-content` → `var(--ink)`/`var(--bg)`, arrow rides.
- F6's hover values landed as exact solids (light `#C01047` 6.16:1, dark `#D41E59` 5.09:1), and
  F5's candy dark toast fill as the deepened cherry `#9C1A47` (7.92:1) — the button/badge dark
  `/60` composites already held and were left to the component.
- Live-verified post-fix (:3199): hero CTA inverse in all four theme-modes (landing census shows
  exactly one accent CTA), candy light course-nav active = white surface + ink + 3px cherry
  spine, all `.text-primary` demoted per mode (candy `#D11450`/`#FF5C8D`, plum dark `#A678EE`),
  dropdown radius 24 → 14, dark glow suppressed on the inverse CTA; SME default byte-unchanged
  (hero 8px/violet fill), zero console errors.

## Addendum 2 — deferred items applied (second pass, same day)

The batch's explicitly deferred items shipped as a second commit:

- **m2/m5 — hardcoded-hue chips → semantic slots.** Every remaining Tailwind
  palette literal on learner/teacher/past-paper surfaces now rides the theme
  slots (`--success/--warn/--warn-ink/--info/--cat/--destructive`):
  dashboard next-best-actions chips (teal/sky/rose/emerald/violet →
  warn/info/destructive/success/cat — `sim` was rejected because plum-light
  sim is raw lavender, 3.97:1 as text, violating the spec's own
  lavender-as-text law), marking queue state pills, κ gate badge, test-builder
  difficulty chips + progress ring + saved flash + stale alert, class
  intelligence bands, teacher-console live badges, assignments late/due-soon
  voices, past-papers partial-coverage chip, interactive-chip coverage counter
  and pdf-pane error icon. SME renders byte-identical (its slot raws are the
  exact shades that were hardcoded) — probed live.
- **Pattern correction the ledger forced:** slot-text-on-own-wash
  (`bg-success/15 text-success`-style) FAILS AA wherever the slot voice is a
  mid-tone (SME light 4.43, candy light 3.74, plum dark 4.21; difficulty
  washes worse). Status chips/pills therefore ship as **outline pills**
  (border-slot/40 + slot text on card — 4.53–17.44:1 across all 64 computed
  pairs, `scripts/contrast_audit_second_pass.py`), matching the hub's own
  status pattern (tutor/state-drawer/assistant). The two genuinely wash-based
  voices keep their designed ink: coverage counter = `bg-warn/15` +
  `text-warn-ink` (7.38–12.76), partial-coverage chip = `bg-warn/10` + theme
  ink (12.16–17.27). κ badge: passed = outline success pill; failed = the
  destructive variant, whose white label rides the engineered fills (4.76
  SME light … 12.81 plum dark on the authored solid).
- **Candy dark danger-text split (new authored rule).** `--destructive`
  keeps the spec's dark cherry `#E61F5F` for fills (white labels ride the
  /60 composite, 7.90), but as 10–11px text on cards it measured 3.85:1.
  `.text-destructive` in candy dark now demotes to the accent-ink voice
  `#FF5C8D` (5.84 on card / 6.46 on paper) — the candy mirror of plum's §3.2
  fill/text split, using the spec's own hover-toward-viewer value.
- **F8 — candy Fraunces h2/h3**: the display chain now covers the spec's
  full h1–h3 band (theme-scoped `:is(h2, h3)`; SME/QG keep their own h2/h3
  voices). Live-probed on landing h2s = Fraunces.
- **F9 — micro-details**: candy `svg.lucide { stroke-width: 2.25 }` (the
  chunky candy hand; CSS overrides the presentation attribute — probed
  2.25px), plum `font-variant-numeric: tabular-nums` on the theme root
  (Inter's tick-voice for timestamps/counters — probed live).
- Verification: lint clean, build clean, standalone :3199 fresh build —
  computed-style probes across sme/qg/candy/plum × light/dark confirm every
  new utility resolves to the theme's own family value; SME byte-identical,
  QG untouched; zero page errors; default restored to sme.
