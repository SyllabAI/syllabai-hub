import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Instrument_Sans,
  Kodchasan,
  Plus_Jakarta_Sans,
  Spline_Sans_Mono,
} from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { AppShell } from "@/components/layout/app-shell";
import { publicConfig } from "@/lib/config";

/**
 * Typography (Task 21-b, matched to the SaveMyExams reference pages):
 *   Plus Jakarta Sans — body (SME: --font-plus-jakarta-sans)
 *   Kodchasan — display headings (SME's display serif for the logo/H1s)
 * next/font self-hosts both at build time; vars are wired in globals.css.
 *
 * Dual-theme support (Quiet Green port): the three QG faces below ship
 * with preload disabled so default-theme (SME) visitors never pay for
 * them — they download only when the quiet-green theme activates and its
 * --app-font-* chains reference the variables.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});
const kodchasan = Kodchasan({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-kodchasan",
  display: "swap",
});
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
  preload: false,
});
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-bricolage",
  display: "swap",
  preload: false,
});
const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
  display: "swap",
  preload: false,
});

/**
 * No-flash theme bootstrap — runs before first paint, mirrors the logic in
 * src/lib/theme-store.ts (same storage key + parsing). Reads
 * { theme: "sme"|"quiet-green", mode: "light"|"dark"|"system" } from
 * localStorage["syllabai-theme"] and applies data-theme + .dark.
 */
const themeBootstrap = `(function(){try{
var t=JSON.parse(localStorage.getItem("syllabai-theme")||"{}");
var theme=t.theme==="quiet-green"?"quiet-green":"sme";
var mode=t.mode||"system";
var dark=mode==="dark"||(mode==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var d=document.documentElement;
d.setAttribute("data-theme",theme);
d.classList.toggle("dark",dark);
d.style.colorScheme=dark?"dark":"light";
}catch(e){}})();`;

export const metadata: Metadata = {
  title: "SyllabAI Hub — IGCSE & IAL revision",
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
      className={`${jakarta.variable} ${kodchasan.variable} ${instrumentSans.variable} ${bricolage.variable} ${splineMono.variable}`}
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
