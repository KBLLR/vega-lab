import type { MouseEvent } from "react";
import { Check, Copy, Layers, Cpu, Home, AlertTriangle, Eye } from "lucide-react";
import { useState } from "react";

export interface ReviewArtifact {
  id: string;
  type: string;
  review_state: "pending" | "accepted" | "rejected";
  visibility: "internal" | "public";
  created_at?: string;
  [key: string]: any;
}

export interface ReviewPanelProps {
  title: string;
  artifacts: ReviewArtifact[];
}

function getIconForType(type: string) {
  switch (type) {
    case "vega.starred-repo":
      return <StarIcon size={16} />;
    case "vega.repo-signal":
    case "vega.repo-analysis":
      return <Layers size={16} />;
    case "vega.skill-candidate":
      return <Cpu size={16} />;
    case "vega.technology-alert":
      return <AlertTriangle size={16} />;
    case "vega.house-idea":
      return <Home size={16} />;
    default:
      return <Eye size={16} />;
  }
}

function StarIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

import { useReview } from "./ReviewContext";

export function ReviewPanel({ title, artifacts }: ReviewPanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { state, dispatch } = useReview();

  const copyToClipboard = async (event: MouseEvent, artifact: ReviewArtifact) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(JSON.stringify(artifact, null, 2));
      setCopiedId(artifact.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error("Failed to copy", e);
    }
  };

  const handleSelectAll = () => {
    if (artifacts.every(a => state.selection.has(a.id))) {
      // Deselect all in this panel
      const newSelection = new Set(state.selection);
      artifacts.forEach(a => newSelection.delete(a.id));
      dispatch({ type: "CLEAR_SELECTION" }); // Simplification for now
    } else {
      dispatch({ type: "SELECT_ALL", payload: [...state.selection, ...artifacts.map(a => a.id)] });
    }
  };

  const handleBatchAction = (newState: "accepted" | "rejected") => {
    const selectedInPanel = artifacts.filter(a => state.selection.has(a.id)).map(a => a.id);
    if (selectedInPanel.length > 0) {
      dispatch({ type: "BATCH_UPDATE_STATE", payload: { ids: selectedInPanel, newState } });
    }
  };

  const filteredArtifacts = artifacts.filter((a) => {
    if (state.filters.type !== "all" && a.type !== state.filters.type) return false;
    if (state.filters.visibility !== "all" && a.visibility !== state.filters.visibility) return false;
    if (state.filters.search) {
      const searchStr = state.filters.search.toLowerCase();
      return (
        (a.skillName || "").toLowerCase().includes(searchStr) ||
        (a.description || "").toLowerCase().includes(searchStr)
      );
    }
    return true;
  });

  return (
    <div className="panel-container" style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ margin: 0, fontSize: "1.5rem", display: "flex", alignItems: "center", gap: "10px" }}>
          {title}
          <span style={{ fontSize: "0.9rem", padding: "2px 8px", background: "var(--accent-color, #e0e0e0)", borderRadius: "12px", color: "var(--text-color, #333)" }}>
            {filteredArtifacts.length} Pending
          </span>
        </h2>
        
        <div style={{ display: "flex", gap: "10px" }}>
          <button 
            onClick={() => handleBatchAction("accepted")}
            style={{ background: "var(--primary-color, #0366d6)", color: "white", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", opacity: state.selection.size > 0 ? 1 : 0.5 }}
            disabled={state.selection.size === 0}
          >
            Accept Selected
          </button>
          <button 
            onClick={() => handleBatchAction("rejected")}
            style={{ background: "#d73a49", color: "white", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", opacity: state.selection.size > 0 ? 1 : 0.5 }}
            disabled={state.selection.size === 0}
          >
            Reject Selected
          </button>
        </div>
      </div>

      {filteredArtifacts.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", background: "var(--bg-card, #f9f9f9)", borderRadius: "8px", color: "var(--text-muted, #666)" }}>
          No artifacts pending review in this category matching filters.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {filteredArtifacts.map((artifact) => (
            <div key={artifact.id} className="repo-card" style={{ display: "flex", flexDirection: "column", gap: "12px", cursor: "default", border: state.selection.has(artifact.id) ? "2px solid var(--primary-color, #0366d6)" : "1px solid var(--border-color, #e1e4e8)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <input 
                    type="checkbox" 
                    checked={state.selection.has(artifact.id)}
                    onChange={() => dispatch({ type: "TOGGLE_SELECTION", payload: artifact.id })}
                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                  />
                  <div style={{ color: "var(--primary-color, #0366d6)" }}>
                    {getIconForType(artifact.type)}
                  </div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                    {artifact.skillName || artifact.technologyName || artifact.proposedName || artifact.sourceRepo || artifact.full_name || artifact.id}
                  </h3>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button 
                    onClick={(e) => copyToClipboard(e, artifact)}
                    className="action-button"
                    title="Copy JSON"
                    style={{ background: "transparent", border: "1px solid var(--border-color, #ccc)", padding: "4px 8px", borderRadius: "4px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}
                  >
                    {copiedId === artifact.id ? <Check size={14} color="green" /> : <Copy size={14} />}
                    {copiedId === artifact.id ? "Copied" : "JSON"}
                  </button>
                  <button 
                    onClick={() => dispatch({ type: "UPDATE_ARTIFACT_STATE", payload: { id: artifact.id, newState: "accepted" } })}
                    style={{ background: "var(--primary-color, #0366d6)", color: "white", border: "none", padding: "4px 12px", borderRadius: "4px", cursor: "pointer" }}
                  >
                    Accept
                  </button>
                  <button 
                    onClick={() => dispatch({ type: "UPDATE_ARTIFACT_STATE", payload: { id: artifact.id, newState: "rejected" } })}
                    style={{ background: "#d73a49", color: "white", border: "none", padding: "4px 12px", borderRadius: "4px", cursor: "pointer" }}
                  >
                    Reject
                  </button>
                </div>
              </div>

              <div style={{ fontSize: "0.9rem", color: "var(--text-muted, #666)" }}>
                {artifact.description || artifact.summary || artifact.theme || "No summary available."}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
                <span className="language-badge" style={{ background: "#eee", padding: "2px 6px", borderRadius: "4px", fontSize: "0.8rem" }}>
                  {artifact.type}
                </span>
                <span style={{ background: "#fff3cd", color: "#856404", padding: "2px 6px", borderRadius: "4px", fontSize: "0.8rem" }}>
                  {artifact.review_state}
                </span>
                <span style={{ background: "#e2e3e5", color: "#383d41", padding: "2px 6px", borderRadius: "4px", fontSize: "0.8rem" }}>
                  {artifact.visibility}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
