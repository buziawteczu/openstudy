/** Tunable browser budgets, not permanent product guarantees. Bytes use MiB. */
export const INGESTION_LIMITS = {
  jsonBytes: 10 * 1024 * 1024,
  zipBytes: 20 * 1024 * 1024,
  extractedBytes: 50 * 1024 * 1024,
  archiveEntries: 100,
  compressionRatio: 200,
  jsonDepth: 100,
  jsonNodes: 200_000,
} as const;

export type IngestionLimits = { readonly [K in keyof typeof INGESTION_LIMITS]: number };
