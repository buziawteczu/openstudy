import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createStudySetJsonSchema } from "./json-schema.js";

const outputPath = fileURLToPath(
  new URL("../study-set.schema.json", import.meta.url),
);
const serialized = `${JSON.stringify(createStudySetJsonSchema(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  let existing: string;

  try {
    existing = readFileSync(outputPath, "utf8");
  } catch {
    console.error("study-set.schema.json is missing; run generate:json-schema");
    process.exitCode = 1;
    process.exit();
  }

  if (existing !== serialized) {
    console.error(
      "study-set.schema.json is stale; run generate:json-schema and commit the result",
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Generated ${outputPath}`);
}

