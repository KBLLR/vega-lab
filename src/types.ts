export interface LanguageInfo {
  language: string;
  percentage: string;
}

export interface Repo {
  name: string;
  description: string;
  author: string;
  stars: number;
  forks: number;
  open_issues: number;
  date: string; // starred_at date
  last_updated: string;
  last_updated_at?: string;
  created_at?: string;
  language?: string;
  primary_language?: string;
  license?: string;
  languages: LanguageInfo[];
  topics: string[];
  url: string;
  private?: boolean;
  has_readme?: boolean | null;
  is_owner?: boolean;
  is_fork?: boolean;
  key_files?: RepoKeyFiles;
}

export interface RepoKeyFiles {
  packageJson?: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  packageManagers?: string[];
  workflows?: string[];
  deploymentConfigs?: string[];
}

export interface LanguageGroup {
  language: string;
  repos: Repo[];
}

export type RepoSignalScope = 'starred' | 'mine' | 'research';
export type RepoStaleness = 'active' | 'watch' | 'stale';
export type ResearchStatus = 'queued' | 'researching' | 'done' | 'dismissed' | 'untracked';
export type AdoptionKind = 'house' | 'tool' | 'service' | 'template' | 'ignore';
export type MissionTarget = 'codex' | 'claude' | 'mlx';

export interface RepoSignal {
  nwo: string;
  name: string;
  author: string;
  description: string;
  scope: RepoSignalScope;
  lastActivityAt: string;
  staleness: RepoStaleness;
  researchStatus: ResearchStatus;
  adoptionScore: number;
  adoptionKind: AdoptionKind;
  reasons: string[];
  houseSkills: string[];
  capabilities: string[];
}

export interface ResearchQueueItem {
  nwo: string;
  status: Exclude<ResearchStatus, 'untracked'>;
  priority: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillExtraction {
  nwo: string;
  name: string;
  author: string;
  summary: string;
  capabilities: string[];
  houseSkills: string[];
  rules: string[];
  flows: string[];
  adoptionKind: AdoptionKind;
  codexBrief: string;
  claudeBrief: string;
}

export interface MineHealthRecord {
  nwo: string;
  name: string;
  author: string;
  visibility: 'public' | 'private';
  hasReadme: boolean | null;
  updatedAt: string;
  healthFlags: string[];
  recommendedActions: string[];
}

export type ActionItemStatus = 'open' | 'reviewing' | 'accepted' | 'dismissed' | 'done';
export type ActionItemKind = 'readme' | 'maintenance' | 'deployment' | 'testing' | 'dependency' | 'research' | 'skill' | 'template' | 'adoption';

export interface RepoInspection {
  nwo: string;
  inspectedAt: string;
  files: {
    hasReadme: boolean | null;
    packageManagers: string[];
    workflows: string[];
    deploymentConfigs: string[];
    testScripts: string[];
    buildScripts: string[];
  };
  findings: string[];
  risks: string[];
}

export interface ActionItem {
  id: string;
  kind: ActionItemKind;
  status: ActionItemStatus;
  priority: 'low' | 'normal' | 'high' | 'critical';
  nwo: string;
  title: string;
  summary: string;
  evidence: string[];
  linkedSkills: string[];
  linkedRules: string[];
  linkedFlows: string[];
  draft: string;
  source: 'daily-ops' | 'weekly-research' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface TemplateKit {
  id: string;
  label: string;
  description: string;
  artifactKinds: string[];
  targets: MissionTarget[];
  templatePaths: string[];
}

export type OpsKitArtifactKind = 'readme' | 'agents' | 'maintenance' | 'deployment' | 'testing' | 'action-item';

export interface OpsKitArtifact {
  kind: OpsKitArtifactKind;
  title: string;
  suggestedPath: string;
  body: string;
  evidence: string[];
}

export interface RepoOpsKit {
  nwo: string;
  generatedAt: string;
  target: MissionTarget;
  artifacts: OpsKitArtifact[];
  evidence: string[];
  recommendedActions: string[];
}

export interface AutomationRunRecord {
  id: string;
  kind: 'daily-ops' | 'weekly-research';
  startedAt: string;
  completedAt: string;
  status: 'success' | 'partial' | 'failed';
  createdActionItemIds: string[];
  notes: string[];
}

export interface OpsDigest {
  generatedAt: string;
  summary: string;
  counts: {
    openActions: number;
    criticalActions: number;
    ownedRepos: number;
    researchQueue: number;
  };
  highlights: string[];
  recommendedActions: Array<{
    id: string;
    nwo: string;
    title: string;
    priority: ActionItem['priority'];
    kind: ActionItemKind;
  }>;
  actionItemIds: string[];
}

export interface WeeklyResearchReview {
  generatedAt: string;
  summary: string;
  brightStars: string[];
  adoptionCandidates: string[];
  skillCandidates: string[];
  researchCandidates: string[];
  actionItemIds: string[];
}

export type VegaActionKind =
  | 'repo.inspect'
  | 'snapshot.resolve'
  | 'candidate.build'
  | 'candidate.validate'
  | 'dossier.generate'
  | 'review.queue'
  | 'ops-kit.generate'
  | 'mission.generate';

export type VegaActionStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface VegaActionRequest {
  action_kind: VegaActionKind;
  repo?: {
    name: string;
    author?: string;
    nwo?: string;
  };
  candidate_id?: string;
  parameters?: Record<string, unknown>;
  write?: boolean;
}

export interface VegaActionStep {
  id: string;
  label: string;
  status: VegaActionStatus;
  detail?: string;
  started_at?: string;
  completed_at?: string;
}

export interface VegaActionResult {
  schema_version: 'vega.action-result.v1';
  action_id: string;
  action_kind: VegaActionKind;
  status: VegaActionStatus;
  review_state: 'pending';
  visibility: 'internal';
  repo?: {
    nwo: string;
    name?: string;
    author?: string;
  };
  candidate_id?: string;
  started_at: string;
  completed_at: string;
  steps: VegaActionStep[];
  artifacts: Array<{
    kind: string;
    path?: string;
    title?: string;
    checksum?: string;
  }>;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
