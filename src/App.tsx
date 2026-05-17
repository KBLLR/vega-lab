import { startTransition, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import {
  Activity,
  BarChart3,
  Compass,
  Github,
  Inbox,
  LayoutGrid,
  Search,
  Star,
  Table as TableIcon,
  User,
  Check
} from "lucide-react";
import { RepoCard } from "./components/RepoCard";
import { RepoTable } from "./components/RepoTable";
import { ReadmePanel } from "./components/ReadmePanel";
import { ChatPanel } from "./components/ChatPanel";
import { Statistics } from "./components/Statistics";
import { ActivityLog } from "./components/ActivityLog";
import { HighlightsPanel } from "./components/HighlightsPanel";
import { MyReposPanel } from "./components/MyReposPanel";
import { RuntimeSettingsPanel } from "./components/RuntimeSettingsPanel";
import { OpsInboxPanel } from "./components/OpsInboxPanel";
import { ReviewPanel } from "./components/ReviewPanel";
import { useReview } from "./components/ReviewContext";
import { logger } from "./lib/logger";
import { getReadmeActionPresets } from "./lib/orchestrator";
import type {
  LanguageGroup,
  ActionItem,
  MineHealthRecord,
  OpsDigest,
  Repo,
  RepoSignal,
  ResearchQueueItem,
  WeeklyResearchReview,
} from "./types";

async function fetchJson<T>(paths: string[]): Promise<T | null> {
  for (const currentPath of paths) {
    try {
      const response = await fetch(currentPath);
      if (!response.ok) continue;
      return await response.json() as T;
    } catch {
      // keep trying fallback paths
    }
  }
  return null;
}

function normalizeRepoPayload(jsonData: unknown): Repo[] {
  if (!Array.isArray(jsonData)) return [];

  if (
    jsonData.length === 0
    || (jsonData[0] && typeof jsonData[0] === "object" && "name" in jsonData[0])
  ) {
    return jsonData as Repo[];
  }

  return (jsonData as LanguageGroup[]).flatMap((group) => group.repos || []);
}

function App() {
  const [allRepos, setAllRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "table" | "statistics" | "activity" | "news" | "mine" | "ops" | "review">("cards");

  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [isReadmeOpen, setIsReadmeOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [readmeAction, setReadmeAction] = useState<string | null>(null);
  const [readmeAutoRun, setReadmeAutoRun] = useState(false);
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);
  const [chatAutoSend, setChatAutoSend] = useState(false);

  const [bookmarks, setBookmarks] = useState<Repo[]>([]);
  const [history, setHistory] = useState<Repo[]>([]);
  const [myRepos, setMyRepos] = useState<Repo[]>([]);
  const [repoSignals, setRepoSignals] = useState<RepoSignal[]>([]);
  const [researchQueue, setResearchQueue] = useState<ResearchQueueItem[]>([]);
  const [mineHealth, setMineHealth] = useState<MineHealthRecord[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [opsDigest, setOpsDigest] = useState<OpsDigest | null>(null);
  const [weeklyResearchReview, setWeeklyResearchReview] = useState<WeeklyResearchReview | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; repo: Repo } | null>(null);
  
  const { state: reviewState, dispatch: reviewDispatch } = useReview();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const [selectedTag, setSelectedTag] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [mineSearchTerm, setMineSearchTerm] = useState("");
  const [mineVisibility, setMineVisibility] = useState<"all" | "public" | "private">("all");
  const [mineDateRange, setMineDateRange] = useState<"all" | "7d" | "30d" | "90d" | "180d" | "365d">("all");

  const repoKey = (repo: Repo) => `${repo.author}/${repo.name}`;

  const refreshHouseData = async () => {
    const [signals, queue, health, actions, digest, weekly] = await Promise.all([
      fetchJson<RepoSignal[]>(["/repo-signals.json", "/data/repo-signals.json"]),
      fetchJson<ResearchQueueItem[]>(["/research-queue.json", "/data/research-queue.json"]),
      fetchJson<MineHealthRecord[]>(["/mine-health.json", "/data/mine-health.json"]),
      fetchJson<ActionItem[]>(["/action-items.json", "/data/action-items.json"]),
      fetchJson<OpsDigest>(["/ops-digest.json", "/data/ops-digest.json"]),
      fetchJson<WeeklyResearchReview>(["/weekly-research-review.json", "/data/weekly-research-review.json"]),
    ]);

    startTransition(() => {
      setRepoSignals(Array.isArray(signals) ? signals : []);
      setResearchQueue(Array.isArray(queue) ? queue : []);
      setMineHealth(Array.isArray(health) ? health : []);
      setActionItems(Array.isArray(actions) ? actions : []);
      setOpsDigest(digest && !Array.isArray(digest) ? digest : null);
      setWeeklyResearchReview(weekly && !Array.isArray(weekly) ? weekly : null);
    });
  };

  const refreshReviewArtifacts = async () => {
    try {
      // Use Vite's glob import to dynamically load JSON files from data/review subfolders
      const starSyncModules = import.meta.glob<{ default: ReviewArtifact }>('../data/review/star-sync/*.json');
      const repoSignalsModules = import.meta.glob<{ default: ReviewArtifact }>('../data/review/repo-signals/*.json');
      const skillCandidatesModules = import.meta.glob<{ default: ReviewArtifact }>('../data/review/skill-candidates/*.json');
      const techAlertsModules = import.meta.glob<{ default: ReviewArtifact }>('../data/review/tech-alerts/*.json');
      const houseIdeasModules = import.meta.glob<{ default: ReviewArtifact }>('../data/review/house-ideas/*.json');

      const loadModules = async (modules: Record<string, () => Promise<{ default: ReviewArtifact }>>) => {
        const values = await Promise.all(Object.values(modules).map(fn => fn().then(m => m.default).catch(() => null)));
        return values.filter(Boolean) as any[];
      };

      const [starSync, repoSignals, skillCandidates, techAlerts, houseIdeas] = await Promise.all([
        loadModules(starSyncModules),
        loadModules(repoSignalsModules),
        loadModules(skillCandidatesModules),
        loadModules(techAlertsModules),
        loadModules(houseIdeasModules),
      ]);

      startTransition(() => {
        reviewDispatch({
          type: "SET_ARTIFACTS",
          payload: {
            starSync,
            repoSignals,
            skillCandidates,
            techAlerts,
            houseIdeas
          }
        });
      });
    } catch (e) {
      console.error("Failed to load review artifacts", e);
    }
  };

  useEffect(() => {
    void refreshReviewArtifacts();
  }, []);

  const recordHistory = (repo: Repo) => {
    setHistory((previous) => {
      const filtered = previous.filter((entry) => repoKey(entry) !== repoKey(repo));
      return [repo, ...filtered].slice(0, 50);
    });
  };

  const handleRepoClick = (repo: Repo) => {
    logger.logEvent(logger.createRepoViewEvent(repo, view === "table" ? "table" : "card"));
    setSelectedRepo(repo);
    setIsReadmeOpen(true);
    recordHistory(repo);
  };

  const openReadmeWithAction = (repo: Repo, prompt?: string, autoRun = false) => {
    setSelectedRepo(repo);
    setIsReadmeOpen(true);
    if (prompt) {
      setReadmeAction(prompt);
      setReadmeAutoRun(autoRun);
    }
  };

  const openChatWithPrefill = (repo: Repo, prompt?: string, autoSend = false) => {
    setSelectedRepo(repo);
    setIsChatOpen(true);
    if (prompt) {
      setChatPrefill(prompt);
      setChatAutoSend(autoSend);
    }
  };

  const handleResearch = (repo: Repo) => {
    logger.logEvent({
      type: "vega-lab:research_started",
      house_id: "vega-lab",
      timestamp: new Date().toISOString(),
      data: {
        action: "research",
        repo_name: repo.name,
        message: `Queueing ${repo.name} for research`,
      },
    });
    openChatWithPrefill(
      repo,
      "Queue this repo for research, explain why it matters, and summarize the adoption fit. Use update_research_queue and extract_repo_skills.",
      true,
    );
  };

  const handleSimilar = (repo: Repo) => {
    logger.logEvent({
      type: "tool.call",
      house_id: "vega-lab",
      timestamp: new Date().toISOString(),
      tool_name: "find_similar_repos",
      tool_id: `similar-${Date.now()}`,
      arguments: { name: repo.name },
    });
    openChatWithPrefill(
      repo,
      "Find similar repos, explain the match logic, and suggest which one is the best adoption candidate.",
      true,
    );
  };

  const handleChat = (repo: Repo) => {
    openChatWithPrefill(repo);
  };

  const isBookmarked = (repo: Repo) => bookmarks.some((entry) => repoKey(entry) === repoKey(repo));

  const toggleBookmark = (repo: Repo) => {
    setBookmarks((previous) => {
      const exists = previous.some((entry) => repoKey(entry) === repoKey(repo));
      if (exists) {
        return previous.filter((entry) => repoKey(entry) !== repoKey(repo));
      }
      return [repo, ...previous];
    });
  };

  const handleContextMenu = (event: MouseEvent, repo: Repo) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, repo });
  };

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    fetch("/data.json")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json() as Promise<unknown>;
      })
      .then((jsonData) => {
        const flat = normalizeRepoPayload(jsonData);
        startTransition(() => {
          setAllRepos(flat);
          setLoading(false);
        });
      })
      .catch((nextError: Error) => {
        setError(nextError.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void refreshHouseData();
  }, []);

  useEffect(() => {
    try {
      const storedBookmarks = localStorage.getItem("vega-lab:bookmarks") || localStorage.getItem("git-stars:bookmarks");
      if (storedBookmarks) setBookmarks(JSON.parse(storedBookmarks) as Repo[]);
      const storedHistory = localStorage.getItem("vega-lab:history") || localStorage.getItem("git-stars:history");
      if (storedHistory) setHistory(JSON.parse(storedHistory) as Repo[]);
      const storedMine = localStorage.getItem("vega-lab:my-repos") || localStorage.getItem("git-stars:my-repos");
      if (storedMine) setMyRepos(JSON.parse(storedMine) as Repo[]);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("vega-lab:bookmarks", JSON.stringify(bookmarks));
    } catch {
      // ignore
    }
  }, [bookmarks]);

  useEffect(() => {
    try {
      localStorage.setItem("vega-lab:history", JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem("vega-lab:my-repos", JSON.stringify(myRepos));
    } catch {
      // ignore
    }
  }, [myRepos]);

  useEffect(() => {
    fetchJson<Repo[]>(["/my-repos.json", "/data/my-repos.json", "/data/owned-repos.json"])
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) return;
        startTransition(() => {
          setMyRepos(data);
        });
      })
      .catch(() => undefined);
  }, []);

  const languages = useMemo(() => {
    const values = new Set<string>();
    allRepos.forEach((repo) => {
      repo.languages?.forEach((entry) => values.add(entry.language));
    });
    return Array.from(values).sort();
  }, [allRepos]);

  const tags = useMemo(() => {
    const values = new Set<string>();
    allRepos.forEach((repo) => {
      repo.topics?.forEach((topic) => values.add(topic));
    });
    return Array.from(values).sort();
  }, [allRepos]);

  const processedRepos = useMemo(() => {
    const filtered = allRepos.filter((repo) => {
      const matchSearch =
        !searchTerm
        || repo.name.toLowerCase().includes(searchTerm.toLowerCase())
        || (repo.description || "").toLowerCase().includes(searchTerm.toLowerCase());

      const matchLanguage =
        selectedLanguage === "all"
        || repo.languages?.some((entry) => entry.language === selectedLanguage);

      const matchTag = selectedTag === "all" || repo.topics?.includes(selectedTag);
      return matchSearch && matchLanguage && matchTag;
    });

    return [...filtered].sort((left: Repo, right: Repo) => {
      switch (sortBy) {
        case "name":
          return left.name.localeCompare(right.name);
        case "date":
          return Date.parse(right.date || "0") - Date.parse(left.date || "0");
        case "created":
          return Date.parse(right.last_updated || "0") - Date.parse(left.last_updated || "0");
        case "language":
          return (left.languages?.[0]?.language || "").localeCompare(right.languages?.[0]?.language || "");
        case "tag":
          return (left.topics?.[0] || "").localeCompare(right.topics?.[0] || "");
        default:
          return 0;
      }
    });
  }, [allRepos, searchTerm, selectedLanguage, selectedTag, sortBy]);

  const ownedRepos = useMemo(
    () => myRepos.filter((repo) => repo.is_owner !== false),
    [myRepos],
  );

  const processedMineRepos = useMemo(() => {
    const rangeMap: Record<string, number> = {
      "7d": 7,
      "30d": 30,
      "90d": 90,
      "180d": 180,
      "365d": 365,
    };
    const days = rangeMap[mineDateRange] || 0;
    const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

    return ownedRepos.filter((repo) => {
      const matchSearch =
        !mineSearchTerm
        || repo.name.toLowerCase().includes(mineSearchTerm.toLowerCase())
        || (repo.description || "").toLowerCase().includes(mineSearchTerm.toLowerCase());

      const matchVisibility =
        mineVisibility === "all"
        || (mineVisibility === "private" ? !!repo.private : !repo.private);

      if (!cutoff) {
        return matchSearch && matchVisibility;
      }

      const dateValue = repo.last_updated_at || repo.last_updated || repo.date || "";
      const parsed = Date.parse(dateValue);
      const matchDate = Number.isFinite(parsed) ? parsed >= cutoff : true;
      return matchSearch && matchVisibility && matchDate;
    });
  }, [mineDateRange, mineSearchTerm, mineVisibility, ownedRepos]);

  if (loading) {
    return (
      <div className="app-container">
        <div style={{ padding: "20px", textAlign: "center" }}>Loading analytics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-container">
        <div className="error-message" style={{ margin: "20px", padding: "20px", background: "#fee", color: "red" }}>
          Error loading data: {error}
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="main-header">
        <a
          href="/"
          className="header-brand"
          onClick={(event) => {
            event.preventDefault();
            window.location.reload();
          }}
        >
          <Github size={28} />
          <span>Vega Lab</span>
        </a>

        <div className="nav-capsule">
          <button onClick={() => setView("cards")} className={`nav-item ${view === "cards" ? "active" : ""}`}>
            <LayoutGrid size={16} /> Cards
          </button>
          <button onClick={() => setView("table")} className={`nav-item ${view === "table" ? "active" : ""}`}>
            <TableIcon size={16} /> Table
          </button>
          <button onClick={() => setView("statistics")} className={`nav-item ${view === "statistics" ? "active" : ""}`}>
            <BarChart3 size={16} /> Stats
          </button>
          <button onClick={() => setView("activity")} className={`nav-item ${view === "activity" ? "active" : ""}`}>
            <Activity size={16} /> Activity
          </button>
          <button onClick={() => setView("news")} className={`nav-item ${view === "news" ? "active" : ""}`}>
            <Compass size={16} /> News
          </button>
          <button onClick={() => setView("ops")} className={`nav-item ${view === "ops" ? "active" : ""}`}>
            <Inbox size={16} /> Ops
          </button>
          <button onClick={() => setView("review")} className={`nav-item ${view === "review" ? "active" : ""}`}>
            <Check size={16} /> Review
          </button>
          <button onClick={() => setView("mine")} className={`nav-item ${view === "mine" ? "active" : ""}`}>
            <User size={16} /> Mine
          </button>
        </div>

        <div className="header-stats">
          <div className="stat-badge" title="Total Stars">
            <Star size={14} fill="currentColor" className="text-muted" />
            {view === "ops" ? actionItems.filter((item) => item.status === "open").length : view === "mine" ? processedMineRepos.length : processedRepos.length} {view === "ops" ? "Open" : "Repos"}
          </div>
          <RuntimeSettingsPanel />
        </div>
      </header>

      {view !== "statistics" && view !== "activity" && view !== "news" && view !== "ops" && view !== "review" && (
        <div className="filters-container">
          {view === "mine" ? (
            <>
              <div className="filter-input-wrapper">
                <Search size={18} />
                <input
                  type="text"
                  className="filter-input"
                  placeholder="Search my repos..."
                  value={mineSearchTerm}
                  onChange={(event) => setMineSearchTerm(event.target.value)}
                />
              </div>
              <div className="filter-group" style={{ display: "flex", gap: 12 }}>
                <select className="filter-select" value={mineVisibility} onChange={(event) => setMineVisibility(event.target.value as typeof mineVisibility)}>
                  <option value="all">Visibility: All</option>
                  <option value="public">Public only</option>
                  <option value="private">Private only</option>
                </select>
                <select className="filter-select" value={mineDateRange} onChange={(event) => setMineDateRange(event.target.value as typeof mineDateRange)}>
                  <option value="all">Updated: Any time</option>
                  <option value="7d">Updated: 7 days</option>
                  <option value="30d">Updated: 30 days</option>
                  <option value="90d">Updated: 90 days</option>
                  <option value="180d">Updated: 6 months</option>
                  <option value="365d">Updated: 1 year</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="filter-input-wrapper">
                <Search size={18} />
                <input
                  type="text"
                  className="filter-input"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>

              <div className="filter-group" style={{ display: "flex", gap: 12 }}>
                <select className="filter-select" value={selectedLanguage} onChange={(event) => setSelectedLanguage(event.target.value)}>
                  <option value="all">All Languages</option>
                  {languages.map((language) => (
                    <option key={language} value={language}>{language}</option>
                  ))}
                </select>

                <select className="filter-select" value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)}>
                  <option value="all">All Tags</option>
                  {tags.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>

                <select className="filter-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                  <option value="name">Sort: Name</option>
                  <option value="date">Sort: Date Starred</option>
                  <option value="created">Sort: Recently Updated</option>
                  <option value="language">Sort: Language</option>
                </select>
              </div>
            </>
          )}
        </div>
      )}

      <div className="primary-view">
        {view === "statistics" ? (
          <Statistics starredRepos={allRepos} myRepos={myRepos} />
        ) : view === "news" ? (
          <HighlightsPanel
            repos={allRepos}
            myRepos={myRepos}
            repoSignals={repoSignals}
            researchQueue={researchQueue}
            actionItems={actionItems}
            opsDigest={opsDigest}
            bookmarks={bookmarks}
            history={history}
            onSelectRepo={handleRepoClick}
            onLaunchAction={(repo, prompt) => openReadmeWithAction(repo, prompt, true)}
          />
        ) : view === "ops" ? (
          <OpsInboxPanel
            actionItems={actionItems}
            opsDigest={opsDigest}
            weeklyResearchReview={weeklyResearchReview}
            repos={[...myRepos, ...allRepos]}
            onSelectRepo={handleRepoClick}
            onLaunchAction={(repo, prompt) => openChatWithPrefill(repo, prompt, true)}
          />
        ) : view === "mine" ? (
          <MyReposPanel
            myRepos={processedMineRepos}
            mineHealth={mineHealth}
            actionItems={actionItems}
            onLaunchAction={(repo, prompt, useChat) => {
              if (useChat) {
                openChatWithPrefill(repo, prompt, true);
                return;
              }
              openReadmeWithAction(repo, prompt, true);
            }}
            renderRepoCard={(repo) => (
              <RepoCard
                key={`${repo.author}-${repo.name}`}
                repo={repo}
                onClick={handleRepoClick}
                onChat={handleChat}
                onResearch={handleResearch}
                onSimilar={handleSimilar}
                onContextMenu={handleContextMenu}
                onBookmark={toggleBookmark}
                isBookmarked={isBookmarked(repo)}
              />
            )}
          />
        ) : view === "activity" ? (
          <ActivityLog />
        ) : (
          <div id="reposContainer" className={view === "cards" ? "repos-grid" : "repo-table-container"}>
            {view === "cards" ? (
              processedRepos.map((repo, index) => (
                <RepoCard
                  key={`${repo.author}-${repo.name}-${index}`}
                  repo={repo}
                  onClick={handleRepoClick}
                  onChat={handleChat}
                  onResearch={handleResearch}
                  onSimilar={handleSimilar}
                  onContextMenu={handleContextMenu}
                  onBookmark={toggleBookmark}
                  isBookmarked={isBookmarked(repo)}
                />
              ))
            ) : (
              <RepoTable repos={processedRepos} onRowClick={handleRepoClick} />
            )}
          </div>
        )}
        {view === "review" && (
          <div className="review-dashboard" style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "20px" }}>
            <ReviewPanel title="Star Sync Artifacts" artifacts={reviewState.artifacts.starSync} />
            <ReviewPanel title="Repo Signals" artifacts={reviewState.artifacts.repoSignals} />
            <ReviewPanel title="Skill Candidates" artifacts={reviewState.artifacts.skillCandidates} />
            <ReviewPanel title="Technology Alerts" artifacts={reviewState.artifacts.techAlerts} />
            <ReviewPanel title="House Ideas" artifacts={reviewState.artifacts.houseIdeas} />
          </div>
        )}
      </div>

      <ReadmePanel
        isOpen={isReadmeOpen}
        onClose={() => setIsReadmeOpen(false)}
        repo={selectedRepo}
        actionPrompt={readmeAction || undefined}
        autoRunAction={readmeAutoRun}
        onActionConsumed={() => {
          setReadmeAction(null);
          setReadmeAutoRun(false);
        }}
        onHouseDataChanged={() => void refreshHouseData()}
        actionPresets={getReadmeActionPresets(view === "mine" ? "mine" : "general")}
      />

      <ChatPanel
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        repo={selectedRepo}
        prefill={chatPrefill || undefined}
        autoSend={chatAutoSend}
        onPrefillConsumed={() => {
          setChatPrefill(null);
          setChatAutoSend(false);
        }}
        onRunComplete={() => void refreshHouseData()}
      />

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button onClick={() => { openReadmeWithAction(contextMenu.repo); setContextMenu(null); }}>
            Open readme + actions
          </button>
          <button onClick={() => { openChatWithPrefill(contextMenu.repo); setContextMenu(null); }}>
            Open orchestrator
          </button>
          <button onClick={() => { openChatWithPrefill(contextMenu.repo, "Find similar repos and explain the match logic.", true); setContextMenu(null); }}>
            Find similar
          </button>
          <button onClick={() => { openChatWithPrefill(contextMenu.repo, "Queue this repo for research, explain why it matters, and summarize the adoption fit.", true); setContextMenu(null); }}>
            Queue research
          </button>
        </div>
      )}
    </>
  );
}

export default App;
