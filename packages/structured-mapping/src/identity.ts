import type { MappingIdentity } from "./contracts.js";

/** Shared new-import identity strategy. Crypto remains the caller's responsibility. */
export const canonicalId = (identity: MappingIdentity, suffix: string): string =>
  "os:" + identity.namespace + ":" + suffix;
export const validIdentity = (identity: MappingIdentity): boolean =>
  /^[a-f0-9]{32}$/.test(identity.namespace);
