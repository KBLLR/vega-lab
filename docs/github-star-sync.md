# GitHub Star Sync

The Star Sync module safely pulls metadata about starred repositories from GitHub.

## API Integration
- Uses native `fetch` against GitHub REST APIs.
- Endpoints: `https://api.github.com/user/starred` (authenticated) or `https://api.github.com/users/{username}/starred` (unauthenticated fallback).
- Handles pagination and gracefully respects rate limits (`/rate_limit`).

## Authentication & Safety
- **Token Handling:** The module reads `GITHUB_TOKEN` from the environment. It never logs, prints, or writes the token to disk.
- **Fallback:** If no token is provided, it attempts to fetch public stars for a configured username.

## Output Structure
Outputs are saved as internal JSON artifacts under `data/review/star-sync/`.

Fields extracted include:
- `full_name`, `html_url`, `clone_url`
- `description`, `topics`, `language`, `license`
- `stars`, `forks`, `open_issues`
- `pushed_at`, `starred_at` (if using appropriate media types)
- `archived`, `fork`, `private` status
- `readme_status`

These outputs serve as the input for the Repo Signal pipeline.
