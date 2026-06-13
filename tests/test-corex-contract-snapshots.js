#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const contractsRoot = path.join(projectRoot, "contracts", "corex");

function sha256Bytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main() {
  const expected = [
    "corex.vega-skill-candidate.v1.schema.json",
    "corex.vega-skill-review.v1.schema.json",
    "manifest.json",
    "README.md",
  ];

  const entries = new Set(await fs.readdir(contractsRoot));
  for (const name of expected) {
    assert.ok(entries.has(name), `Missing Core-X contract snapshot: ${name}`);
  }

  const manifest = await readJson(path.join(contractsRoot, "manifest.json"));
  assert.equal(manifest.contract_set, "corex.vega-skill-contracts");
  assert.equal(manifest.version, "1");
  assert.equal(manifest.generated_from, "core-x");
  assert.ok(!JSON.stringify(manifest).includes("/Users/"));
  assert.ok(!JSON.stringify(manifest).includes("/tmp/"));
  assert.ok(!JSON.stringify(manifest).includes("feat/"));

  for (const schema of manifest.schemas) {
    const bytes = await fs.readFile(path.join(contractsRoot, schema.name));
    assert.equal(sha256Bytes(bytes), schema.sha256, `Checksum mismatch for ${schema.name}`);
  }

  const candidateSchema = await readJson(path.join(contractsRoot, "corex.vega-skill-candidate.v1.schema.json"));
  const reviewSchema = await readJson(path.join(contractsRoot, "corex.vega-skill-review.v1.schema.json"));
  assert.equal(candidateSchema.properties.schema_version.const, "corex.vega-skill-candidate.v1");
  assert.equal(reviewSchema.properties.schema_version.const, "corex.vega-skill-review.v1");

  const ajv = new Ajv2020({
    allErrors: true,
    coerceTypes: false,
    strict: true,
    useDefaults: false,
  });
  ajv.compile(candidateSchema);
  ajv.compile(reviewSchema);
}

main().catch((error) => {
  console.error("Core-X contract snapshot test failed");
  console.error(error);
  process.exit(1);
});
