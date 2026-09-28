/** Tunable browser budgets, not permanent product guarantees. Bytes use MiB. */
export const INGESTION_LIMITS = {
  jsonBytes: 10 * 1024 * 1024,
  zipBytes: 20 * 1024 * 1024,
  extractedBytes: 50 * 1024 * 1024,
  archiveEntries: 100,
  compressionRatio: 200,
  jsonDepth: 100,
  jsonNodes: 200_000,
  docxBytes: 20 * 1024 * 1024,
  pdfBytes: 25 * 1024 * 1024,
  docxEntries: 1_000,
  docxExtractedBytes: 50 * 1024 * 1024,
  docxXmlBytes: 8 * 1024 * 1024,
  documentNodes: 200_000,
  documentDepth: 100,
  documentBlocks: 10_000,
  documentCharacters: 2_000_000,
  pdfPages: 300,
  pdfItems: 100_000,
  pdfMinimumTextCharacters: 10,
} as const;

export type IngestionLimits = { readonly [K in keyof typeof INGESTION_LIMITS]: number };
