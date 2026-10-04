import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { AppShell } from "@/components/layout/app-shell";
import { publicConfig } from "@/lib/config";

/**
 * Typography (Task 21-b, matched to the SaveMyExams reference pages):
 *   Plus Jakarta Sans — body (SME: --font-plus-jakarta-sans)
 *   Kodchasan — display headings (SME's display serif for the logo/H1s)
 *
 * Pinned fonts (T-C36): every face below is a COMMITTED ASSET in src/fonts/
 * — the exact woff2 bytes Google's css2 API served on 2026-09-29 (gstatic
 * version paths, sha256s and OFL license texts recorded in
 * src/fonts/MANIFEST.md) — loaded via next/font/local. The build performs
 * ZERO font network fetches, which retires the next/font/google Turbopack
 * flake seen on cold CI runners, and the font versions are pinned by bytes
 * in git instead of floating on Google's CDN. CSS variable names, display
 * and preload semantics are identical to the previous next/font/google
 * setup; adjustFontFallback keeps the Arial-metric fallback next/font
 * generated before.
 *
 * Dual-theme support (Quiet Green port): the three QG faces below ship
 * with preload disabled so default-theme (SME) visitors never pay for
 * them — they download only when the quiet-green theme activates and its
 * --app-font-* chains reference the variables. Candy Shop follows the
 * same pattern (Fraunces display / Nunito body, preload: false), and
 * Chat App Plum too (Inter everywhere — one family, Law 8 of its spec).
 */
const jakarta = localFont({
  src: "../fonts/plus-jakarta-sans-latin-var.woff2",
  weight: "200 800",
  variable: "--font-jakarta",
  display: "swap",
  adjustFontFallback: "Arial",
});
const kodchasan = localFont({
  src: [
    { path: "../fonts/kodchasan-latin-400.woff2", weight: "400" },
    { path: "../fonts/kodchasan-latin-500.woff2", weight: "500" },
    { path: "../fonts/kodchasan-latin-600.woff2", weight: "600" },
    { path: "../fonts/kodchasan-latin-700.woff2", weight: "700" },
  ],
  variable: "--font-kodchasan",
  display: "swap",
  adjustFontFallback: "Arial",
});
const instrumentSans = localFont({
  src: "../fonts/instrument-sans-latin-var.woff2",
  weight: "400 700",
  variable: "--font-instrument-sans",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});
const bricolage = localFont({
  src: "../fonts/bricolage-grotesque-latin-var.woff2",
  weight: "600 700",
  variable: "--font-bricolage",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});
const splineMono = localFont({
  src: "../fonts/spline-sans-mono-latin-var.woff2",
  weight: "300 700",
  variable: "--font-spline-mono",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});
const fraunces = localFont({
  src: "../fonts/fraunces-latin-var.woff2",
  weight: "600 700",
  variable: "--font-fraunces",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});
const nunito = localFont({
  src: "../fonts/nunito-latin-var.woff2",
  weight: "400 800",
  variable: "--font-nunito",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});
const inter = localFont({
  src: "../fonts/inter-latin-var.woff2",
  weight: "400 700",
  variable: "--font-inter",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});

/**
 * No-flash theme bootstrap — runs before first paint, mirrors the logic in
 * src/lib/theme-store.ts (same storage key + parsing). Reads
 * { theme: "sme"|"quiet-green"|"candy-shop"|"chat-app-plum",
 *   mode: "light"|"dark"|"system" }
 * from localStorage["syllabai-theme"] and applies data-theme + .dark.
 */
const themeBootstrap = `(function(){try{
var t=JSON.parse(localStorage.getItem("syllabai-theme")||"{}");
var theme=t.theme==="quiet-green"?"quiet-green":t.theme==="candy-shop"?"candy-shop":t.theme==="chat-app-plum"?"chat-app-plum":"sme";
var mode=t.mode||"system";
var dark=mode==="dark"||(mode==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var d=document.documentElement;
d.setAttribute("data-theme",theme);
d.classList.toggle("dark",dark);
d.style.colorScheme=dark?"dark":"light";
}catch(e){}})();`;

export const metadata: Metadata = {
  // UX audit 2026-10-02 #14: a template brands every nested title (pages
  // export the bare page name; the suffix is appended exactly once here).
  title: {
    default: "SyllabAI Hub — IGCSE & IAL revision",
    template: "%s — SyllabAI Hub",
  },
  description:
    "Spec-anchored revision for Edexcel IGCSE & IAL: notes, exam questions, flashcards, past papers and a grounded AI tutor — mapped to your syllabus.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const config = publicConfig();
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${kodchasan.variable} ${instrumentSans.variable} ${bricolage.variable} ${splineMono.variable} ${fraunces.variable} ${nunito.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        {/* blocking inline script — applies the stored theme before any
            content paints, so there is no light/dark flash on load */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <AppShell config={config}>{children}</AppShell>
        <Toaster />
      </body>
    </html>
  );
}
