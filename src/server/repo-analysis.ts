import fs from 'fs/promises';
import path from 'path';

const SIGNALS_DIR = path.resolve(process.cwd(), 'data/review/repo-signals');

export interface AnalyzeOptions {
  repoPath: string;
  gatewayUrl?: string; // e.g. http://127.0.0.1:8080/bus/v1/responses
}

export async function analyzeRepo(options: AnalyzeOptions): Promise<void> {
  const { repoPath, gatewayUrl = 'http://127.0.0.1:8080/bus/v1/responses' } = options;

  await fs.mkdir(SIGNALS_DIR, { recursive: true });

  const rawData = await fs.readFile(repoPath, 'utf-8');
  const repoArtifact = JSON.parse(rawData);

  if (repoArtifact.type !== 'vega.starred-repo') {
    throw new Error(`Invalid artifact type: ${repoArtifact.type}. Expected vega.starred-repo`);
  }

  // Attempt to fetch README if not present (simple unauthenticated fetch to raw.githubusercontent)
  let readme = '';
  if (repoArtifact.full_name) {
    try {
      const readmeRes = await fetch(`https://raw.githubusercontent.com/${repoArtifact.full_name}/main/README.md`);
      if (readmeRes.ok) {
        readme = await readmeRes.text();
      } else {
        const readmeResMaster = await fetch(`https://raw.githubusercontent.com/${repoArtifact.full_name}/master/README.md`);
        if (readmeResMaster.ok) {
          readme = await readmeResMaster.text();
        }
      }
    } catch {
      console.log(`[Vega Analysis] Could not fetch README for ${repoArtifact.full_name}`);
    }
  }

  // Construct prompt
  const systemPrompt = `You are Vega Labs connected intelligence. Analyze the following GitHub repository and output a JSON object adhering to the vega.repo-analysis schema.
  
Identify its primary capabilities, potential integration value into the Core-X ecosystem, and recommended action. 
Core-X is a multi-agent, local-first ecosystem (houses, MLX services, WebGPU).
Must output valid JSON only.

Schema requirements:
- id: a unique string
- sourceRepo: the repo full_name
- evidenceRefs: array of strings
- summary: string
- tags: array of strings
- confidence: number between 0 and 1
- recommendedAction: string (e.g. 'watch', 'integrate', 'skill-candidate', 'ignore')
- review_state: 'pending'
- visibility: 'internal'
- derived_from: array of strings (e.g. the input artifact id)
- generated_by: 'vega-labs-analysis-pipeline'
- created_at: ISO date string
`;

  const inputPrompt = `Repo Metadata:
${JSON.stringify({
  name: repoArtifact.full_name,
  description: repoArtifact.description,
  topics: repoArtifact.topics,
  language: repoArtifact.language,
  stars: repoArtifact.stars
}, null, 2)}

README Snippet (first 2000 chars):
${readme.slice(0, 2000)}
`;

  console.log(`[Vega Analysis] Requesting analysis for ${repoArtifact.full_name}...`);

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: inputPrompt }
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

  try {
    const parsed = JSON.parse(content);
    // Enforce defaults
    parsed.review_state = "pending";
    parsed.visibility = "internal";
    if (!parsed.id) parsed.id = `repo-analysis-${Date.now()}`;
    if (!parsed.created_at) parsed.created_at = new Date().toISOString();
    
    const safeName = repoArtifact.full_name.replace(/\//g, '_');
    const outPath = path.join(SIGNALS_DIR, `${safeName}.json`);
    
    await fs.writeFile(outPath, JSON.stringify(parsed, null, 2));
    console.log(`[Vega Analysis] Saved analysis to ${outPath}`);
  } catch (e) {
    console.error(`[Vega Analysis] Failed to parse JSON from response. Raw output saved.`, e);
    const safeName = repoArtifact.full_name.replace(/\//g, '_');
    await fs.writeFile(path.join(SIGNALS_DIR, `${safeName}.error.txt`), content);
  }
}
