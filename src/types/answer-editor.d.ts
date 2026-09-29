// Ambient typings for the wave-4 answer editor (HUB-ANSWER-BOX).
// MathLive ships its custom <math-field> element; the module registers the
// element on import and is driven via refs — the surface types are ambient.
declare module "mathlive";

// Proper augmentation (import first, so this EXTENDS react's JSX instead of
// shadowing the whole react module — shadowing broke every React import).
import type * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "math-field": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
