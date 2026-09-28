import type { NextConfig } from "next";

const PILOT = "igcse-chemistry-19";

/**
 * Browser-direct core origin (ADR-029: browser→core calls are direct, so the
 * origin must be allowed in connect-src). Resolved from the same env the api
 * client reads; empty in mock/dev mode where every call stays same-origin.
 */
const CORE_ORIGIN = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "")
  .replace(/\/$/, "")
  .replace(/\/api\/v1$/, "");

/**
 * Content-Security-Policy (promotion-plan Phase-1 item 6).
 *
 * Allow-list is derived from what the app actually loads — nothing speculative:
 * - scripts: Next's inline bootstrap needs 'unsafe-inline'; no third-party
 *   scripts exist in the repo. Dev additionally needs 'unsafe-eval' for the
 *   React refresh runtime.
 * - styles: inline style attributes across the component tree + KaTeX.
 * - images: hotlinked corpus images live on raw.githubusercontent.com
 *   (ADR-013 posture unchanged).
 * - connect: same-origin API proxies + pdf.js range-fetches past-paper PDFs
 *   from raw.githubusercontent.com + the browser-direct core origin.
 * - frames: the KG explorer and graph explorer are SAME-ORIGIN self-frames
 *   (public/kg/*.html), so frame-ancestors is 'self' — 'none' would break our
 *   own embeds while 'self' still blocks cross-site framing (with
 *   X-Frame-Options: SAMEORIGIN as the legacy fallback).
 * - fonts: next/font self-hosts at build; KaTeX ships with the bundle.
 */
const isDev = process.env.NODE_ENV === "development";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://raw.githubusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self' https://raw.githubusercontent.com${CORE_ORIGIN ? ` ${CORE_ORIGIN}` : ""}`,
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Security headers applied to every route, including the self-framed static
 * explorer HTML under /kg (frame-ancestors 'self' / SAMEORIGIN keep our own
 * iframes working while blocking foreign-site embedding).
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Microphone is deliberately NOT restricted — the tutor composer's
  // dictation uses the Web Speech API, which rides on the mic permission.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), interest-cohort=()" },
];

/**
 * The per-course Learning Hub is the primary IA now. The pre-hub experiment
 * surfaces live on as redirects (query strings like ?spec=4CH1-1.1 are
 * preserved automatically), so every old deep link keeps working.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Type errors now fail the build: the previous ignoreBuildErrors:true let a
  // runtime crash (undefined property access on the hub page) ship silently.
  typescript: {},
  reactStrictMode: false,
  async redirects() {
    return [
      { source: "/revision-notes", destination: `/courses/${PILOT}/revision-notes`, permanent: false },
      { source: "/revision-notes/:noteId", destination: `/courses/${PILOT}/revision-notes/:noteId`, permanent: false },
      { source: "/exam-questions", destination: `/courses/${PILOT}/exam-questions`, permanent: false },
      { source: "/flashcards", destination: `/courses/${PILOT}/flashcards`, permanent: false },
      // Retired demo surface (teacher-console tranche): the SAMPLE class graph
      // is superseded by Class intelligence over live core data. URL-level so
      // it fires for every visitor before the auth layout renders.
      { source: "/teacher/class-graph", destination: "/teacher/class", permanent: true },
    ];
  },
};

export default nextConfig;
