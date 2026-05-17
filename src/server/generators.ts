import fs from 'fs/promises';
import path from 'path';
// @ts-expect-error - no types for ocr-tools.js
import { executeVegaOcrTool } from './ocr-tools.js';

const REVIEW_DIR = path.resolve(process.cwd(), 'data/review');

export interface GeneratorOptions {
  sourceId: string;
  gatewayUrl?: string;
  ocrImageUrl?: string;
}

/**
 * Ensures the review output directory exists for a given category.
 */
async function ensureDir(category: string): Promise<string> {
  const dirPath = path.join(REVIEW_DIR, category);
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Base prompt execution using the openresponses gateway
 */
async function runGenerator(prompt: string, gatewayUrl: string): Promise<Record<string, any>> {
  console.log(`[Vega Generators] Requesting generation via ${gatewayUrl}...`);
  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are Vega Labs connected intelligence. Output valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      stream: false,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`Gateway returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || data.content?.text || '';
  return JSON.parse(content);
}

/**
 * Processes optional OCR before generation. (Phase 6)
 */
async function processOptionalOcr(options: GeneratorOptions): Promise<string> {
  if (!options.ocrImageUrl) return '';
  
  console.log(`[Vega Generators] Running OCR on ${options.ocrImageUrl}...`);
  try {
    const ocrResult = await executeVegaOcrTool(process.cwd(), 'extract_text', { image_url: options.ocrImageUrl });
    if (ocrResult.success) {
      return `\nOCR Evidence from image:\n${JSON.stringify(ocrResult.artifact || ocrResult.data, null, 2)}\n`;
    }
  } catch (e) {
    console.warn(`[Vega Generators] OCR Failed for ${options.ocrImageUrl}`, e);
  }
  return '';
}

/**
 * Generates a SKILL Candidate (Phase 7)
 */
export async function generate_skill_candidate(options: GeneratorOptions): Promise<void> {
  const ocrText = await processOptionalOcr(options);
  const prompt = `Generate a SKILL candidate based on source artifact ${options.sourceId}.
${ocrText}
Schema requirements:
- id: string
- type: "vega.skill-candidate"
- skillName: string
- description: string
- proposedInstructions: string
- sourceArtifactId: string
- review_state: "pending"
- visibility: "internal"
- created_at: ISO date string`;

  try {
    const result = await runGenerator(prompt, options.gatewayUrl || 'http://127.0.0.1:8080/bus/v1/responses');
    result.type = "vega.skill-candidate";
    result.sourceArtifactId = options.sourceId;
    result.review_state = "pending";
    result.visibility = "internal";
    if (!result.id) result.id = `skill-candidate-${Date.now()}`;
    if (!result.created_at) result.created_at = new Date().toISOString();

    const dir = await ensureDir('skill-candidates');
    await fs.writeFile(path.join(dir, `${result.id}.json`), JSON.stringify(result, null, 2));
    console.log(`[Vega Generators] Saved SKILL candidate ${result.id}`);
  } catch (e) {
    console.error(`[Vega Generators] Failed to generate SKILL candidate`, e);
  }
}

/**
 * Generates a Technology Alert (Phase 8)
 */
export async function generate_technology_alert(options: GeneratorOptions): Promise<void> {
  const ocrText = await processOptionalOcr(options);
  const prompt = `Generate a Technology Alert based on source artifact ${options.sourceId}.
${ocrText}
Schema requirements:
- id: string
- type: "vega.technology-alert"
- technologyName: string
- impactLevel: "low" | "medium" | "high" | "critical"
- summary: string
- suggestedAction: string
- sourceArtifactId: string
- review_state: "pending"
- visibility: "internal"
- created_at: ISO date string`;

  try {
    const result = await runGenerator(prompt, options.gatewayUrl || 'http://127.0.0.1:8080/bus/v1/responses');
    result.type = "vega.technology-alert";
    result.sourceArtifactId = options.sourceId;
    result.review_state = "pending";
    result.visibility = "internal";
    if (!result.id) result.id = `tech-alert-${Date.now()}`;
    if (!result.created_at) result.created_at = new Date().toISOString();

    const dir = await ensureDir('tech-alerts');
    await fs.writeFile(path.join(dir, `${result.id}.json`), JSON.stringify(result, null, 2));
    console.log(`[Vega Generators] Saved Technology Alert ${result.id}`);
  } catch (e) {
    console.error(`[Vega Generators] Failed to generate Technology Alert`, e);
  }
}

/**
 * Generates a House Idea Candidate (Phase 9)
 */
export async function generate_house_idea_candidate(options: GeneratorOptions): Promise<void> {
  const ocrText = await processOptionalOcr(options);
  const prompt = `Generate a House Idea Candidate based on source artifact ${options.sourceId}.
${ocrText}
Schema requirements:
- id: string
- type: "vega.house-idea"
- proposedName: string
- theme: string
- capabilities: array of strings
- sourceArtifactId: string
- review_state: "pending"
- visibility: "internal"
- created_at: ISO date string`;

  try {
    const result = await runGenerator(prompt, options.gatewayUrl || 'http://127.0.0.1:8080/bus/v1/responses');
    result.type = "vega.house-idea";
    result.sourceArtifactId = options.sourceId;
    result.review_state = "pending";
    result.visibility = "internal";
    if (!result.id) result.id = `house-idea-${Date.now()}`;
    if (!result.created_at) result.created_at = new Date().toISOString();

    const dir = await ensureDir('house-ideas');
    await fs.writeFile(path.join(dir, `${result.id}.json`), JSON.stringify(result, null, 2));
    console.log(`[Vega Generators] Saved House Idea Candidate ${result.id}`);
  } catch (e) {
    console.error(`[Vega Generators] Failed to generate House Idea Candidate`, e);
  }
}
