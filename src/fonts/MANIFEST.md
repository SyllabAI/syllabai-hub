# Pinned font assets (T-C36, fetched 2026-09-29)

Every woff2 in this directory is the EXACT file Google's css2 API served for
`src/app/layout.tsx` on 2026-09-29 (Chrome-class UA, `display=swap`), fetched
once and committed. `src/app/layout.tsx` loads them via `next/font/local`,
so production builds perform ZERO font network fetches — the
next/font/google Turbopack CI flake is retired by construction, and the font
versions are pinned by bytes in git.

Provenance per file (css2 query, the immutable gstatic version URL, sha256):

| file | family | weights served by css2 | declared weight range | bytes | sha256 |
|---|---|---|---|---|---|
| `plus-jakarta-sans-latin-var.woff2` | plus-jakarta-sans | 200 800 | 200 800 | 27,348 | `153fc85b70298bee…` |
| `kodchasan-latin-400.woff2` | kodchasan | 400 | 400 | 15,104 | `f3a5b6beb733e8cb…` |
| `kodchasan-latin-500.woff2` | kodchasan | 500 | 500 | 15,304 | `41674cb0b2639bd2…` |
| `kodchasan-latin-600.woff2` | kodchasan | 600 | 600 | 15,180 | `56cd1649cbd685c6…` |
| `kodchasan-latin-700.woff2` | kodchasan | 700 | 700 | 14,164 | `05c2ce1f1ebb7b7f…` |
| `instrument-sans-latin-var.woff2` | instrument-sans | 400 700 | 400 700 | 30,092 | `2ee17598a98d8a59…` |
| `bricolage-grotesque-latin-var.woff2` | bricolage-grotesque | 600; 700 | 600 700 | 41,344 | `a97804dc9fbe5fc9…` |
| `spline-sans-mono-latin-var.woff2` | spline-sans-mono | 300 700 | 300 700 | 36,476 | `46b7dcafe3e51dbe…` |
| `fraunces-latin-var.woff2` | fraunces | 600; 700 | 600 700 | 36,620 | `7f9d191d999336d3…` |
| `nunito-latin-var.woff2` | nunito | 400; 600; 700; 800 | 400 800 | 39,128 | `ba344451eab25b21…` |
| `inter-latin-var.woff2` | inter | 400; 500; 600; 700 | 400 700 | 48,256 | `3100e775e8616cd2…` |

## Source URLs (immutable gstatic version paths)

- plus-jakarta-sans: https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2
- kodchasan: https://fonts.gstatic.com/s/kodchasan/v20/1cXxaUPOAJv9sG4I-DJWiHGF.woff2
- kodchasan: https://fonts.gstatic.com/s/kodchasan/v20/1cX0aUPOAJv9sG4I-DJee1KQhuCp.woff2
- kodchasan: https://fonts.gstatic.com/s/kodchasan/v20/1cX0aUPOAJv9sG4I-DJeV1WQhuCp.woff2
- kodchasan: https://fonts.gstatic.com/s/kodchasan/v20/1cX0aUPOAJv9sG4I-DJeM1SQhuCp.woff2
- instrument-sans: https://fonts.gstatic.com/s/instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1Q.woff2
- bricolage-grotesque: https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9H6as8bTXq_nANBjzKo3IeZx8z6up5BeSl5jBNz_19PpbpMXuECpwUxJBOm_OJWiawA1Xp.woff2
- spline-sans-mono: https://fonts.gstatic.com/s/splinesansmono/v13/R70BjzAei_CDNLfgZxrW6wrZOF2WX5KZmA.woff2
- fraunces: https://fonts.gstatic.com/s/fraunces/v38/6NUu8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib14c7qv8.woff2
- nunito: https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaB.woff2
- inter: https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2

- css2 endpoint: `https://fonts.googleapis.com/css2?family=…&display=swap`
- Only `latin` faces are vendored — layout.tsx declares `subsets: ["latin"]`
  and nothing else was served to browsers before the pin.
- Weight arrays in layout.tsx: for the four variable-font families (Inter,
  Nunito, Fraunces, Bricolage Grotesque) Google serves the SAME variable file
  for every discrete weight (fvar-verified), so each is ONE committed asset
  declared over the union range the app uses. Kodchasan is a genuinely static
  family — four instanced files. The three families loaded without a weight
  list (Plus Jakarta Sans, Instrument Sans, Spline Sans Mono) are the variable
  files over their full axis.

## Licenses

All eight families are distributed under the SIL Open Font License 1.1; the
verbatim upstream license text for each family is vendored in `licenses/`
(source: github.com/google/fonts, `ofl/<family>/OFL.txt`, fetched 2026-09-29).
Re-derivation: re-run `/home/z/my-project/scripts/fetch_hub_fonts.py` — any
byte drift (upstream font update) becomes a reviewable diff of this
directory, which is the point of the pin.
