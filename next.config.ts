import type { NextConfig } from "next";

const PILOT = "igcse-chemistry-19";

/**
 * The per-course Learning Hub is the primary IA now. The pre-hub experiment
 * surfaces live on as redirects (query strings like ?spec=4CH1-1.1 are
 * preserved automatically), so every old deep link keeps working.
 */
const nextConfig: NextConfig = {
  output: "standalone",
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
