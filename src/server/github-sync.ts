import fs from 'fs/promises';
import path from 'path';

const REVIEW_DIR = path.resolve(process.cwd(), 'data/review/star-sync');

export interface SyncOptions {
  username?: string;
  maxPages?: number;
}

export async function syncStarredRepos(options: SyncOptions = {}): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const username = options.username || 'davidcaballero'; // Fallback to public user
  const maxPages = options.maxPages || 5; // Prevent runaway fetches

  let url = token 
    ? 'https://api.github.com/user/starred?per_page=100'
    : `https://api.github.com/users/${username}/starred?per_page=100`;

  // Standard GitHub REST headers
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Vega-Labs-Sync'
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  await fs.mkdir(REVIEW_DIR, { recursive: true });

  let page = 1;
  let syncedCount = 0;
  let rateLimitRemaining: number | null = null;

  try {
    while (url && page <= maxPages) {
      console.log(`[Vega Sync] Fetching ${url}...`);
      const response = await fetch(url, { headers });

      rateLimitRemaining = parseInt(response.headers.get('x-ratelimit-remaining') || '0', 10);
      
      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) break;

      for (const repo of data) {
        // Construct vega.starred-repo.schema.json artifact
        const artifactId = `repo-${repo.id}`;
        
        const artifact = {
          id: artifactId,
          type: "vega.starred-repo",
          full_name: repo.full_name,
          html_url: repo.html_url,
          clone_url: repo.clone_url || null,
          description: repo.description || null,
          topics: repo.topics || [],
          language: repo.language || null,
          license: repo.license || null,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          open_issues: repo.open_issues_count,
          pushed_at: repo.pushed_at || null,
          starred_at: null, // Requires custom Accept header for starred_at, skipping for simplicity
          archived: repo.archived,
          is_fork: repo.fork,
          private: repo.private,
          readme_status: "unknown",
          source_metadata: repo,
          sync_run_id: `sync-${Date.now()}`,
          review_state: "pending",
          visibility: "internal"
        };

        const safeName = repo.full_name.replace(/\//g, '_');
        const filePath = path.join(REVIEW_DIR, `${safeName}.json`);
        await fs.writeFile(filePath, JSON.stringify(artifact, null, 2));
        syncedCount++;
      }

      // Handle Link header for pagination
      const linkHeader = response.headers.get('link');
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch ? nextMatch[1] : '';
      } else {
        url = '';
      }
      
      page++;
    }

    // Write final sync log
    const logArtifact = {
      id: `sync-log-${Date.now()}`,
      type: "vega.sync-log",
      timestamp: new Date().toISOString(),
      status: "success",
      items_synced: syncedCount,
      rate_limit_remaining: rateLimitRemaining,
      error_details: null,
      review_state: "pending",
      visibility: "internal"
    };
    await fs.writeFile(path.join(REVIEW_DIR, '_sync_log.json'), JSON.stringify(logArtifact, null, 2));
    console.log(`[Vega Sync] Complete. Synced ${syncedCount} items.`);

  } catch (error) {
    console.error("[Vega Sync] Error:", error);
    const logArtifact = {
      id: `sync-log-${Date.now()}`,
      type: "vega.sync-log",
      timestamp: new Date().toISOString(),
      status: "error",
      items_synced: syncedCount,
      rate_limit_remaining: rateLimitRemaining,
      error_details: error instanceof Error ? error.message : String(error),
      review_state: "pending",
      visibility: "internal"
    };
    await fs.writeFile(path.join(REVIEW_DIR, '_sync_log.json'), JSON.stringify(logArtifact, null, 2));
  }
}
