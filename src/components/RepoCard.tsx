import type { MouseEvent } from 'react';
import { Repo } from '../types';
import { Star, GitFork, Calendar, MessageSquare, Microscope, Copy, Bookmark, Lock } from 'lucide-react';
import { getRepoAboutUrl } from '../lib/repo-links';

interface RepoCardProps {
  repo: Repo;
  onClick: (repo: Repo) => void;
  onChat?: (repo: Repo) => void;
  onResearch?: (repo: Repo) => void;
  onSimilar?: (repo: Repo) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>, repo: Repo) => void;
  onBookmark?: (repo: Repo) => void;
  isBookmarked?: boolean;
}

const TITLE_ACRONYMS = new Set([
  'ai',
  'api',
  'ar',
  'cli',
  'css',
  'glsl',
  'gpu',
  'html',
  'http',
  'ik',
  'ios',
  'json',
  'llm',
  'mlx',
  'mcp',
  'ocr',
  'pdf',
  'rag',
  'sdk',
  'ui',
  'ux',
  'vlm',
  'vr',
  'webgl',
  'webgpu',
]);

function formatTitleWord(word: string) {
  const trimmed = word.trim();
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();
  if (/^\d+d$/.test(lowered)) return lowered.toUpperCase();
  if (TITLE_ACRONYMS.has(lowered)) return lowered.toUpperCase();
  if (!/[a-zA-Z]/.test(trimmed)) return trimmed;
  const firstLetterIndex = trimmed.search(/[a-zA-Z]/);
  const prefix = trimmed.slice(0, firstLetterIndex);
  const first = trimmed[firstLetterIndex].toUpperCase();
  const rest = trimmed.slice(firstLetterIndex + 1).toLowerCase();
  return `${prefix}${first}${rest}`;
}

function formatRepoDisplayTitle(name: string) {
  const formatted = name
    .split(/[-_]+/)
    .filter(Boolean)
    .map(formatTitleWord)
    .join(' ');
  return formatted || name;
}

function getTitleLengthClass(title: string) {
  if (title.length > 42) return 'repo-title--compact';
  if (title.length > 30) return 'repo-title--long';
  if (title.length > 18) return 'repo-title--medium';
  return 'repo-title--short';
}

function getRepoProjectKind(repo: Repo) {
  const language = (repo.language || repo.primary_language || repo.languages?.[0]?.language || '').toLowerCase();
  const text = [
    repo.name,
    repo.description,
    language,
    ...(repo.topics || []),
  ].join(' ').toLowerCase();

  if (/\b(three|threejs|webgl|webgpu|shader|glsl|3d|2d|graphics|render|avatar|mesh|gltf|blender)\b/.test(text)) return 'graphics';
  if (/\b(agent|agents|codex|claude|mcp|cli|developer-tool|devtool|template|boilerplate|workflow)\b/.test(text)) return 'devtool';
  if (/\b(ai|llm|mlx|machine-learning|ml|diffusion|neural|vision|ocr|rag|inference|model)\b/.test(text)) return 'ai';
  if (/\b(react|vue|svelte|frontend|web|css|html|javascript|typescript|vite|nextjs|ui)\b/.test(text)) return 'web';
  if (/\b(api|server|backend|gateway|runtime|service|database|postgres|infra|deploy|docker)\b/.test(text)) return 'infra';
  if (/\b(data|dataset|docs|documentation|paper|research|knowledge|benchmark)\b/.test(text)) return 'data';
  return 'generic';
}

export function RepoCard({ repo, onClick, onChat, onResearch, onSimilar, onContextMenu, onBookmark, isBookmarked }: RepoCardProps) {
  const aboutUrl = getRepoAboutUrl(repo);
  const displayTitle = formatRepoDisplayTitle(repo.name);
  const projectKind = getRepoProjectKind(repo);
  const titleLengthClass = getTitleLengthClass(displayTitle);

  return (
    <div
      className={`repo-card repo-card--${projectKind}`}
      onClick={() => onClick(repo)}
      onContextMenu={(event) => onContextMenu?.(event, repo)}
    >
      <button
        className={`bookmark-btn ${isBookmarked ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onBookmark?.(repo);
        }}
        title={isBookmarked ? 'Remove bookmark' : 'Bookmark repo'}
      >
        <Bookmark size={16} fill={isBookmarked ? 'currentColor' : 'none'} />
      </button>
      <h3 className={`repo-title repo-title--${projectKind} ${titleLengthClass}`} title={repo.name}>
        <a href={aboutUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          {repo.private ? (
            <span className="repo-title__lock" title="Private repository">
              <Lock size={14} />
            </span>
          ) : null}
          {displayTitle}
        </a>
      </h3>
      
      <div className="repo-metrics">
        <div className="metric-item">
          <Star size={14} /> {repo.stars}
        </div>
        <div className="metric-item">
          <GitFork size={14} /> {repo.forks}
        </div>
        <div className="metric-item metric-item--date">
          <Calendar size={14} className="text-muted" /> 
           Last active: {repo.last_updated}
        </div>
      </div>

      <p className="repo-desc">
        {repo.description || "No description provided."}
      </p>

      <div className="chip-group">
        {repo.languages.slice(0, 3).map((l) => (
          <span key={l.language} className="chip chip-lang">
            {l.language}
          </span>
        ))}
        {repo.topics.slice(0, 4).map((t) => (
           <span key={t} className="chip chip-tag">
             {t}
           </span>
        ))}
        <span className="chip" style={{ color: '#94a3b8', border: 'none', paddingLeft: 0 }}>
            <Calendar size={12} style={{ marginRight: 4 }} /> 
            Starred {repo.date}
        </span>
      </div>

      <div className="card-actions">
         <button 
           className="action-btn primary"
           onClick={(e) => { e.stopPropagation(); onChat?.(repo); }}
           title="Open tool-aware repo chat"
           aria-label={`Open tool-aware repo chat for ${repo.author}/${repo.name}`}
           data-tooltip="Open tool-aware repo chat."
         >
           <MessageSquare size={14} /> <span className="action-btn__label">Orchestrate</span>
         </button>
         <button 
            className="action-btn"
            onClick={(e) => { e.stopPropagation(); onResearch?.(repo); }}
            title="Queue and assess adoption fit"
            aria-label={`Queue ${repo.author}/${repo.name} for research`}
            data-tooltip="Queue and assess adoption fit."
         >
           <Microscope size={14} /> <span className="action-btn__label">Research</span>
         </button>
         <button 
            className="action-btn"
            onClick={(e) => { e.stopPropagation(); onSimilar?.(repo); }}
            title="Find related repos and compare"
            aria-label={`Find repos similar to ${repo.author}/${repo.name}`}
            data-tooltip="Find related repos and compare."
         >
           <Copy size={14} /> <span className="action-btn__label">Similar</span>
         </button>
      </div>
    </div>
  );
}
