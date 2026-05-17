#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syncStarredRepos } from "../src/server/github-sync.ts";
import { analyzeRepo } from "../src/server/repo-analysis.ts";
import { generate_skill_candidate, generate_technology_alert, generate_house_idea_candidate } from "../src/server/generators.ts";

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("Testing Vega Pipelines...");
  
  // 1. Mock fetch globally
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes("api.github.com/users/testuser/starred") || urlStr.includes("api.github.com/user/starred")) {
      const data = await fs.readFile(path.join(process.cwd(), "tests/fixtures/github/starred-repos.json"), "utf-8");
      return {
        ok: true,
        headers: new Headers({ "x-ratelimit-remaining": "5000" }),
        json: async () => JSON.parse(data)
      };
    } else if (urlStr.includes("raw.githubusercontent.com")) {
      const text = await fs.readFile(path.join(process.cwd(), "tests/fixtures/github/readme.md"), "utf-8");
      return {
        ok: true,
        text: async () => text
      };
    } else if (urlStr.includes("/bus/v1/responses")) {
      const body = JSON.parse(options.body);
      const systemPrompt = body.messages[0].content;
      const userPrompt = body.messages[1].content;
      
      let resJson = {};
      if (systemPrompt.includes("Analyze the following GitHub repository")) {
        const data = await fs.readFile(path.join(process.cwd(), "tests/fixtures/openresponses/repo-analysis.json"), "utf-8");
        resJson = JSON.parse(data);
      } else if (userPrompt.includes("Generate a SKILL candidate")) {
        const data = await fs.readFile(path.join(process.cwd(), "tests/fixtures/openresponses/skill-candidate.json"), "utf-8");
        resJson = JSON.parse(data);
      } else if (userPrompt.includes("Generate a Technology Alert")) {
        const data = await fs.readFile(path.join(process.cwd(), "tests/fixtures/openresponses/technology-alert.json"), "utf-8");
        resJson = JSON.parse(data);
      } else if (userPrompt.includes("Generate a House Idea Candidate")) {
        const data = await fs.readFile(path.join(process.cwd(), "tests/fixtures/openresponses/house-idea.json"), "utf-8");
        resJson = JSON.parse(data);
      }
      
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(resJson) } }]
        })
      };
    }
    
    throw new Error(`Unexpected fetch URL in tests: ${urlStr}`);
  };

  try {
    // 2. Test github-sync.ts
    console.log("-> Testing github-sync.ts");
    await syncStarredRepos({ username: "testuser", maxPages: 1 });
    const syncDir = path.resolve(process.cwd(), "data/review/star-sync");
    assert.ok(await exists(syncDir), "Sync directory should be created");
    
    const repoFile = path.join(syncDir, "testuser_demo-repo.json");
    assert.ok(await exists(repoFile), "Sync should write repo artifact");
    
    const repoData = JSON.parse(await fs.readFile(repoFile, "utf-8"));
    assert.equal(repoData.full_name, "testuser/demo-repo");
    assert.equal(repoData.review_state, "pending");
    assert.equal(repoData.visibility, "internal");
    
    const logFile = path.join(syncDir, "_sync_log.json");
    assert.ok(await exists(logFile), "Sync should write log file");
    
    // 3. Test repo-analysis.ts
    console.log("-> Testing repo-analysis.ts");
    await analyzeRepo({ repoPath: repoFile });
    const signalsDir = path.resolve(process.cwd(), "data/review/repo-signals");
    assert.ok(await exists(signalsDir), "Signals directory should be created");
    
    const signalFile = path.join(signalsDir, "testuser_demo-repo.json");
    assert.ok(await exists(signalFile), "Analysis should write signal artifact");
    
    const signalData = JSON.parse(await fs.readFile(signalFile, "utf-8"));
    assert.equal(signalData.sourceRepo, "testuser/demo-repo");
    assert.equal(signalData.review_state, "pending");
    assert.equal(signalData.visibility, "internal");
    
    // 4. Test generators.ts
    console.log("-> Testing generators.ts");
    await generate_skill_candidate({ sourceId: "test-source-1" });
    await generate_technology_alert({ sourceId: "test-source-2" });
    await generate_house_idea_candidate({ sourceId: "test-source-3" });
    
    const skillsDir = path.resolve(process.cwd(), "data/review/skill-candidates");
    const techDir = path.resolve(process.cwd(), "data/review/tech-alerts");
    const houseDir = path.resolve(process.cwd(), "data/review/house-ideas");
    
    assert.ok(await exists(skillsDir), "Skills directory should be created");
    assert.ok(await exists(techDir), "Tech directory should be created");
    assert.ok(await exists(houseDir), "House directory should be created");
    
    const skills = await fs.readdir(skillsDir);
    assert.ok(skills.length > 0, "Skill candidate should be written");
    const skillData = JSON.parse(await fs.readFile(path.join(skillsDir, skills[0]), "utf-8"));
    assert.equal(skillData.review_state, "pending");
    assert.equal(skillData.visibility, "internal");
    assert.equal(skillData.sourceArtifactId, "test-source-1");
    
    console.log("✅ Pipeline tests passed.");

    // Clean up test data
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(signalsDir, { recursive: true, force: true });
    await fs.rm(skillsDir, { recursive: true, force: true });
    await fs.rm(techDir, { recursive: true, force: true });
    await fs.rm(houseDir, { recursive: true, force: true });

  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error("❌ Pipeline tests failed");
  console.error(error);
  process.exit(1);
});
