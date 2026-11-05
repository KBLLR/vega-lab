import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import {
  Activity,
  BarChart3,
  Compass,
  Inbox,
  LayoutGrid,
  Radar,
  Search,
  Table as TableIcon,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { ObservatoryDesk } from "./components/ObservatoryDesk";
import { useObservatoryData } from "./lib/use-observatory-data";
import { logger } from "./lib/logger";
import { getReadmeActionPresets } from "./lib/orchestrator";
import type { Repo } from "./types";

type View = "desk" | "cards" | "table" | "statistics" | "activity" | "news" | "mine" | "ops";

const NAV_GROUPS: Array<{ label: string; items: Array<{ view: View; label: string; icon: LucideIcon }> }> = [
  {
    label: "Discover",
    items: [
      { view: "desk", label: "Desk", icon: Radar },
      { view: "cards", label: "Catalog", icon: LayoutGrid },
      { view: "table", label: "Table", icon: TableIcon },
      { view: "statistics", label: "Stats", icon: BarChart3 },
    ],
  },
  { label: "Research", items: [{ view: "news", label: "Signals", icon: Compass }] },
  {
    label: "Operate",
    items: [
      { view: "ops", label: "Inbox", icon: Inbox },
      { view: "mine", label: "Mine", icon: User },
    ],
  },
  { label: "System", items: [{ view: "activity", label: "Activity", icon: Activity }] },
];

function App() {
  const data = useObservatoryData();
  // Synthetic previews keep their own browser storage so invented repos never mix with real bookmarks/history.
  const storagePrefix = data.mode === "fixture" ? "vega-lab:fixture:" : "vega-lab:";
  const allRepos = data.starred;
  const repoSignals = data.signals;
  const researchQueue = data.queue;
  const mineHealth = data.mineHealth;
  const actionItems = data.actionItems;
  const opsDigest = data.opsDigest;
  const weeklyResearchReview = data.weeklyReview;
  const [view, setView] = useState<View>("desk");

  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [isReadmeOpen, setIsReadmeOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [readmeAction, setReadmeAction] = useState<string | null>(null);
  const [readmeAutoRun, setReadmeAutoRun] = useState(false);
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);
  const [chatAutoSend, setChatAutoSend] = useState(false);

  const [bookmarks, setBookmarks] = useState<Repo[]>([]);
  const [history, setHistory] = useState<Repo[]>([]);
  const [storedMine, setStoredMine] = useState<Repo[]>([]);
  const myRepos = data.mine.length > 0 || data.mode === "fixture" ? data.mine : storedMine;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; repo: Repo } | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const [selectedTag, setSelectedTag] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [mineSearchTerm, setMineSearchTerm] = useState("");
  const [mineVisibility, setMineVisibility] = useState<"all" | "public" | "private">("all");
  const [mineDateRange, setMineDateRange] = useState<"all" | "7d" | "30d" | "90d" | "180d" | "365d">("all");

  const repoKey = (repo: Repo) => `${repo.author}/${repo.name}`;

  const refreshHouseData = () => data.refreshDerived();

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

  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    // Legacy git-stars:* keys stay readable for one migration cycle (live mode only).
    const legacy = (key: string) => (data.mode === "fixture" ? null : localStorage.getItem(`git-stars:${key}`));
    try {
      const storedBookmarks = localStorage.getItem(`${storagePrefix}bookmarks`) || legacy("bookmarks");
      if (storedBookmarks) setBookmarks(JSON.parse(storedBookmarks) as Repo[]);
      const storedHistory = localStorage.getItem(`${storagePrefix}history`) || legacy("history");
      if (storedHistory) setHistory(JSON.parse(storedHistory) as Repo[]);
      if (data.mode !== "fixture") {
        const cachedMine = localStorage.getItem("vega-lab:my-repos") || legacy("my-repos");
        if (cachedMine) setStoredMine(JSON.parse(cachedMine) as Repo[]);
      }
    } catch {
      // ignore storage errors
    }
    setStorageReady(true);
  }, [data.mode, storagePrefix]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(`${storagePrefix}bookmarks`, JSON.stringify(bookmarks));
    } catch {
      // ignore
    }
  }, [bookmarks, storageReady, storagePrefix]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(`${storagePrefix}history`, JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history, storageReady, storagePrefix]);

  useEffect(() => {
    if (data.mode === "fixture" || data.mine.length === 0) return;
    try {
      localStorage.setItem("vega-lab:my-repos", JSON.stringify(data.mine));
    } catch {
      // ignore
    }
  }, [data.mine, data.mode]);

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

  const headerCount = view === "ops"
    ? `${actionItems.filter((item) => item.status === "open").length} drafts`
    : view === "mine"
      ? `${processedMineRepos.length} owned`
      : `${processedRepos.length + ownedRepos.length} repos`;

  return (
    <>
      <a className="vx-skip" href="#vx-main">Skip to content</a>
      {data.mode === "fixture" ? (
        <div className="vx-fixture-banner" role="note">
          <strong>Synthetic preview.</strong> {data.fixtureLabel || "Invented repositories for previews and tests."}{" "}
          <a href="?">Leave preview</a>
        </div>
      ) : null}
      <header className="main-header vx-topbar">
        <a
          href="?"
          className="header-brand vx-brand"
          aria-label="Vega Lab observatory, reload"
          onClick={(event) => {
            event.preventDefault();
            window.location.reload();
          }}
        >
          <svg className="vx-brand__mark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" strokeDasharray="2 2" />
            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
          </svg>
          <span className="vx-brand__word">Vega</span>
          <span className="vx-brand__sub">Observatory · Core-X</span>
        </a>

        <nav className="vx-nav" aria-label="Vega sections">
          {NAV_GROUPS.map((group) => (
            <div className="vx-nav__group" key={group.label} role="group" aria-label={group.label}>
              <span className="vx-nav__label" aria-hidden="true">{group.label}</span>
              <div className="vx-nav__items">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.view}
                      type="button"
                      onClick={() => setView(item.view)}
                      className={`nav-item vx-nav__item ${view === item.view ? "active" : ""}`}
                      aria-current={view === item.view ? "page" : undefined}
                    >
                      <Icon size={14} aria-hidden="true" /> {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="header-stats vx-topbar__meta">
          <span className="stat-badge vx-meta" aria-live="polite">{headerCount}</span>
          <RuntimeSettingsPanel />
        </div>
      </header>

      {view !== "desk" && view !== "statistics" && view !== "activity" && view !== "news" && view !== "ops" && (
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

      <main className="primary-view" id="vx-main" tabIndex={-1}>
        {view === "desk" ? (
          <ObservatoryDesk
            data={data}
            onPrepareAction={(repo, prompt) => openChatWithPrefill(repo, prompt, false)}
            onOpenReadme={(repo) => handleRepoClick(repo)}
          />
        ) : !data.loading && (view === "cards" || view === "table") && processedRepos.length === 0 ? (
          <div className="my-repos-empty vx-empty-view">
            <h2>{allRepos.length === 0 ? "No starred snapshot" : "No matching repositories"}</h2>
            <p>
              {allRepos.length === 0
                ? "public/data.json was not found. See the Desk for dataset status and how to refresh it locally."
                : "Adjust search, language, or tag filters."}
            </p>
          </div>
        ) : view === "statistics" ? (
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
      </main>

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
