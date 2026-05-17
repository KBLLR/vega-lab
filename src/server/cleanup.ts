import * as fs from 'fs/promises';
import * as path from 'path';

const REVIEW_DIR = path.join(process.cwd(), 'data', 'review');
const ARCHIVE_DIR = path.join(process.cwd(), 'data', 'archive');
const PENDING_TTL_DAYS = 30;

interface ReviewArtifact {
  id?: string;
  type?: string;
  review_state?: 'pending' | 'accepted' | 'rejected';
  created_at?: string;
  [key: string]: any;
}

async function ensureDirectoryExists(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function scanDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await scanDirectory(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.error(`Error scanning directory ${dir}:`, error);
    }
  }
  return files;
}

function isExpired(createdAt: string | undefined): boolean {
  if (!createdAt) return false;
  const createdDate = new Date(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - createdDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > PENDING_TTL_DAYS;
}

export async function runCleanup() {
  console.log(`Starting Vega Labs Artifact Cleanup...`);
  await ensureDirectoryExists(ARCHIVE_DIR);

  const files = await scanDirectory(REVIEW_DIR);
  let archivedCount = 0;
  let purgedCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const artifact = JSON.parse(content) as ReviewArtifact;

      const state = artifact.review_state || 'pending';
      
      if (state === 'accepted' || state === 'rejected') {
        // Move to archive
        const relativePath = path.relative(REVIEW_DIR, filePath);
        const archivePath = path.join(ARCHIVE_DIR, relativePath);
        
        await ensureDirectoryExists(path.dirname(archivePath));
        await fs.rename(filePath, archivePath);
        console.log(`[ARCHIVED] ${relativePath} (State: ${state})`);
        archivedCount++;
      } else if (state === 'pending' && isExpired(artifact.created_at)) {
        // Purge expired pending
        await fs.unlink(filePath);
        console.log(`[PURGED] ${path.relative(REVIEW_DIR, filePath)} (Expired pending)`);
        purgedCount++;
      } else {
        skippedCount++;
      }
    } catch (err: any) {
      console.error(`Error processing file ${filePath}:`, err.message);
    }
  }

  console.log(`\nCleanup Summary:`);
  console.log(`Archived: ${archivedCount}`);
  console.log(`Purged:   ${purgedCount}`);
  console.log(`Skipped:  ${skippedCount} (Active pending)`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCleanup().catch(console.error);
}
