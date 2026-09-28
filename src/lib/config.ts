/**
 * Public (non-secret) runtime configuration surfaced to the client for the
 * mode badges. SERVER secrets are never exported here.
 *
 * Promotion note (ADR-029): there is no local AI provider any more — all AI
 * flows through syllabai-core (`/api/ai/*` routes are server-side proxies
 * that forward the signed-in learner's JWT to core's LlmProvider chain).
 * The badge set therefore shrinks to the data mode + core wiring.
 */
import "server-only";
import { resolveDataMode } from "@/lib/data";
import { isCoreApiConfigured } from "@/lib/data/core-api";

export interface PublicConfig {
  dataMode: "mock" | "core-api";
  coreConfigured: boolean;
}

export function publicConfig(): PublicConfig {
  return {
    dataMode: resolveDataMode(),
    coreConfigured: isCoreApiConfigured(),
  };
}
