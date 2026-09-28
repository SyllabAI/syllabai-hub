import { publicConfig } from "@/lib/config";

export const runtime = "nodejs";

/**
 * GET /api/health — self-report: service identity, active data mode, core
 * wiring. No secrets.
 */
export async function GET() {
  const cfg = publicConfig();
  return Response.json({
    status: "ok",
    service: "syllabai-hub",
    dataMode: cfg.dataMode,
    coreConfigured: cfg.coreConfigured,
    time: new Date().toISOString(),
  });
}
