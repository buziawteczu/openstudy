import type { MappingIdentity } from "@openstudy/mapping";

/** A CSPRNG namespace per selected collection; no imported data influences identity. */
export function createMappingIdentity(): MappingIdentity | undefined {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return { namespace: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("") };
  } catch {
    // Do not fall back to timestamps or Math.random when platform crypto is absent.
    return undefined;
  }
}

export function defaultStudySetTitle(filename: string): string {
  return filename.replace(/\.(json|zip)$/i, "") || "Untitled study set";
}
