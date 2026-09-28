/**
 * Data-provider factory. Selection order:
 *
 *   1. HUB_DATA_MODE env ("mock" | "core-api") — explicit override
 *   2. core-api when SYLLABAI_CORE_BASE_URL is set
 *   3. mock (always available — the bundled-corpus default)
 *
 * The neon provider was removed at promotion (ADR-029): a production
 * frontend must not bypass the core domain layer and touch a database
 * directly. mock | core-api are the only two modes.
 */
import "server-only";
import type { DemoDataProvider } from "./types";
import { mockProvider } from "./mock";
import { coreApiProvider, isCoreApiConfigured } from "./core-api";

export type DataMode = "mock" | "core-api";

export function resolveDataMode(): DataMode {
  const forced = process.env.HUB_DATA_MODE as DataMode | undefined;
  if (forced === "mock" || forced === "core-api") return forced;
  if (isCoreApiConfigured()) return "core-api";
  return "mock";
}

export function getDataProvider(): DemoDataProvider {
  switch (resolveDataMode()) {
    case "core-api":
      return coreApiProvider();
    default:
      return mockProvider();
  }
}
