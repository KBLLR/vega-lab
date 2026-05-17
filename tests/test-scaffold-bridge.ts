import * as fs from 'fs/promises';
import * as path from 'path';
import { runCleanup } from '../src/server/cleanup.js';
import { runScaffoldBridge } from '../src/server/scaffold-bridge.js';

const REVIEW_DIR = path.join(process.cwd(), 'data', 'review');
const ARCHIVE_DIR = path.join(process.cwd(), 'data', 'archive');
const MANIFEST_DIR = path.join(process.cwd(), 'data', 'scaffold-manifests');

async function testPipeline() {
  console.log("=== Testing Vega Labs Pipeline ===");

  // 1. Setup mock data
  const mockAcceptedArtifact = {
    id: "test-artifact-123",
    type: "vega.skill-candidate",
    review_state: "accepted",
    name: "Mock Skill Candidate",
    description: "A test skill candidate for scaffolding bridge.",
    capabilities: ["mock-capability-1", "mock-capability-2"],
    created_at: new Date().toISOString()
  };

  const mockRejectedArtifact = {
    id: "test-artifact-456",
    type: "vega.skill-candidate",
    review_state: "rejected",
    name: "Mock Rejected Skill",
    created_at: new Date().toISOString()
  };

  await fs.mkdir(REVIEW_DIR, { recursive: true });
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.mkdir(MANIFEST_DIR, { recursive: true });

  const acceptedPath = path.join(REVIEW_DIR, 'mock-accepted.json');
  const rejectedPath = path.join(REVIEW_DIR, 'mock-rejected.json');

  await fs.writeFile(acceptedPath, JSON.stringify(mockAcceptedArtifact, null, 2));
  await fs.writeFile(rejectedPath, JSON.stringify(mockRejectedArtifact, null, 2));

  console.log("Created mock artifacts in data/review.");

  // 2. Run Cleanup
  console.log("\nRunning cleanup...");
  await runCleanup();

  // Check if they were moved
  let reviewFiles = await fs.readdir(REVIEW_DIR);
  if (reviewFiles.includes('mock-accepted.json') || reviewFiles.includes('mock-rejected.json')) {
    console.error("❌ Cleanup failed to remove files from review dir.");
    process.exit(1);
  }

  let archiveFiles = await fs.readdir(ARCHIVE_DIR);
  if (!archiveFiles.includes('mock-accepted.json') || !archiveFiles.includes('mock-rejected.json')) {
    console.error("❌ Cleanup failed to move files to archive dir.");
    process.exit(1);
  }
  console.log("✅ Cleanup successfully moved accepted/rejected artifacts to archive.");

  // 3. Run Scaffold Bridge
  console.log("\nRunning Scaffold Bridge...");
  await runScaffoldBridge();

  // Check if manifest was generated
  let manifestFiles = await fs.readdir(MANIFEST_DIR);
  const generatedManifest = manifestFiles.find(f => f.startsWith('manifest-mock-skill-candidate'));
  
  if (!generatedManifest) {
    console.error("❌ Scaffold Bridge failed to generate manifest.");
    process.exit(1);
  }

  const manifestContent = JSON.parse(await fs.readFile(path.join(MANIFEST_DIR, generatedManifest), 'utf-8'));
  if (manifestContent.app_id !== "mock-skill-candidate") {
    console.error("❌ Scaffold Bridge generated incorrect app_id.");
    process.exit(1);
  }

  console.log(`✅ Scaffold Bridge successfully generated manifest: ${generatedManifest}`);

  // Check if artifact was marked as scaffolded
  const archivedAcceptedContent = JSON.parse(await fs.readFile(path.join(ARCHIVE_DIR, 'mock-accepted.json'), 'utf-8'));
  if (!archivedAcceptedContent.scaffolded) {
    console.error("❌ Scaffold Bridge failed to mark artifact as scaffolded.");
    process.exit(1);
  }

  console.log("✅ Pipeline tests passed successfully!\n");

  // Cleanup test files
  await fs.unlink(path.join(ARCHIVE_DIR, 'mock-accepted.json'));
  await fs.unlink(path.join(ARCHIVE_DIR, 'mock-rejected.json'));
  await fs.unlink(path.join(MANIFEST_DIR, generatedManifest));
  console.log("Cleaned up test files.");
}

testPipeline().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
