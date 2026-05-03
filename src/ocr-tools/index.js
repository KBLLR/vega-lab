#!/usr/bin/env node

import path from "path";
import { fileURLToPath } from "url";
import { executeVegaOcrTool, OCR_TOOL_DEFINITIONS } from "../server/ocr-tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOUSE_ROOT = path.resolve(__dirname, "../..");

async function main() {
  const [command, toolName, rawArgs = "{}"] = process.argv.slice(2);
  if (command === "list") {
    console.log(JSON.stringify({ tools: OCR_TOOL_DEFINITIONS }, null, 2));
    return;
  }
  if (command === "call" && toolName) {
    const args = JSON.parse(rawArgs);
    const result = await executeVegaOcrTool(HOUSE_ROOT, toolName, args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.error("Usage: node src/ocr-tools/index.js list | call <tool-name> <json-args>");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
