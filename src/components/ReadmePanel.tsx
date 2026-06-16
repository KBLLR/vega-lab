import { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ExternalLink, Sparkles, Wand2, X } from "lucide-react";
import type { Repo } from "../types";
import type { VegaActionKind } from "../types";
import { formatVegaActionResult, inferActionFromPrompt, runVegaAction } from "../lib/action-bridge";
import { streamOpenResponses } from "../lib/openresponses-client";
import { fetchRuntimeModels } from "../lib/runtime-client";
import type { ActionPreset, VegaLabRoute } from "../lib/orchestrator";
import {
  buildVegaLabTools,
  buildSystemPrompt,
  HOUSE_ID,
  routeVegaLabIntent,
} from "../lib/orchestrator";
import { getRepoAboutUrl } from "../lib/repo-links";
import { loadRuntimeSettings, resolveRuntimeTarget, SETTINGS_EVENT } from "../lib/settings";

interface ReadmePanelProps {
  isOpen: boolean;
  onClose: () => void;
  repo: Repo | null;
  actionPrompt?: string;
  autoRunAction?: boolean;
  onActionConsumed?: () => void;
  onHouseDataChanged?: () => void;
  actionPresets: ActionPreset[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ReadmePanel({
  isOpen,
  onClose,
  repo,
  actionPrompt,
  autoRunAction,
  onActionConsumed,
  onHouseDataChanged,
  actionPresets,
}: ReadmePanelProps) {
  const [content, setContent] = useState("");
  const [rawMarkdown, setRawMarkdown] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("local-model");
  const [runtimeTarget, setRuntimeTarget] = useState(() =>
    resolveRuntimeTarget(loadRuntimeSettings()),
  );
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayTitle, setOverlayTitle] = useState("");
  const [overlayContent, setOverlayContent] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeRoute, setActiveRoute] = useState<VegaLabRoute | null>(null);
  const lastActionRef = useRef<string | null>(null);
  const streamRef = useRef<AbortController | null>(null);

  const aboutUrl = repo ? getRepoAboutUrl(repo) : "#";

  const renderMarkdown = useCallback(async (text: string) => {
    try {
      const html = await marked.parse(text);
      setContent(DOMPurify.sanitize(html));
    } catch {
      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      setContent(`<pre>${escaped}</pre>`);
    }
  }, []);

  const runAction = useCallback((
    prompt: string,
    title: string,
    actionKind?: VegaActionKind,
    actionParameters?: Record<string, unknown>,
    write?: boolean,
  ) => {
    if (!repo) return;
    const actionId = `action-${Date.now()}`;
    const route = routeVegaLabIntent(prompt);
    const activeMissionTarget = runtimeTarget.mode === "local" ? "mlx" : "codex";
    const inferredAction = actionKind
      ? { actionKind, parameters: actionParameters, write }
      : inferActionFromPrompt(prompt, activeMissionTarget);

    if (inferredAction) {
      setActiveRoute(route);
      setOverlayTitle(title);
      setOverlayContent("Starting typed Vega action...");
      setOverlayVisible(true);
      setIsRunning(true);

      const userMessage: ChatMessage = { id: `${actionId}-user`, role: "user", content: prompt };
      const assistantMessage: ChatMessage = { id: `${actionId}-assistant`, role: "assistant", content: "" };
      setMessages((previous) => [...previous, userMessage, assistantMessage]);

      runVegaAction({
        repo,
        actionKind: inferredAction.actionKind,
        parameters: inferredAction.parameters,
        write: inferredAction.write,
      })
        .then((result) => {
          const formatted = formatVegaActionResult(result);
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantMessage.id ? { ...message, content: formatted } : message,
            ),
          );
          setOverlayContent(formatted);
          onHouseDataChanged?.();
        })
        .catch((nextError: Error) => {
          const errorText = `Tooling error: ${nextError.message}`;
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantMessage.id ? { ...message, content: errorText } : message,
            ),
          );
          setOverlayContent(errorText);
        })
        .finally(() => setIsRunning(false));
      return;
    }

    const excerpt = rawMarkdown.slice(0, 4000);
    const conversation = [
      {
        role: "system",
        content: `${buildSystemPrompt(repo, route)}\n\nREADME excerpt:\n${excerpt || "No README loaded."}`,
      },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content: prompt },
    ];

    setActiveRoute(route);
    setOverlayTitle(title);
    setOverlayContent("");
    setOverlayVisible(true);
    setIsRunning(true);

    const userMessage: ChatMessage = { id: `${actionId}-user`, role: "user", content: prompt };
    const assistantMessage: ChatMessage = { id: `${actionId}-assistant`, role: "assistant", content: "" };

    setMessages((previous) => [...previous, userMessage, assistantMessage]);

    streamRef.current?.abort();
    streamRef.current = streamOpenResponses({
      endpoint: `${runtimeTarget.busUrl}${runtimeTarget.responsesPath}`,
      body: {
        model: selectedModel || runtimeTarget.model || "local-model",
        messages: conversation,
        tools: buildVegaLabTools(),
        tool_choice: "auto",
        agent_id: route.agentId,
        house_id: HOUSE_ID,
        task_kind: route.capability,
        target_repo: { author: repo.author, name: repo.name },
        required_capabilities: [route.capability, "tool_execution"],
        evidence_policy: "required",
        model_profile: runtimeTarget.modelProfile,
      },
      onEvent: (event) => {
        if (event.type === "response.output_text.delta" && event.delta) {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: `${message.content}${event.delta}` }
                : message,
            ),
          );
          setOverlayContent((previous) => `${previous}${event.delta}`);
        }
      },
      onComplete: () => {
        setIsRunning(false);
        onHouseDataChanged?.();
      },
      onError: (nextError) => {
        setIsRunning(false);
        setOverlayContent(`Error: ${nextError.message}`);
      },
    });
  }, [messages, onHouseDataChanged, rawMarkdown, repo, runtimeTarget, selectedModel]);

  useEffect(() => {
    if (!isOpen || !repo) return;

    setLoading(true);
    setContent("");
    setRawMarkdown("");
    setMessages([]);

    const tryFetch = (branch: string) =>
      fetch(`https://raw.githubusercontent.com/${repo.author}/${repo.name}/${branch}/README.md`)
        .then(async (response) => (response.ok ? response.text() : ""));

    tryFetch("master")
      .then((text) => text || tryFetch("main"))
      .then(async (text) => {
        if (text) {
          setRawMarkdown(text);
          await renderMarkdown(text);
          return;
        }
        setContent("README not found");
      })
      .catch(() => {
        setContent("Failed to load README");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, renderMarkdown, repo]);

  useEffect(() => {
    if (!isOpen) return;

    fetchRuntimeModels(runtimeTarget.busUrl)
      .then((runtimeModels) => {
        if (runtimeModels.length > 0) {
          setModels(runtimeModels);
          setSelectedModel((previous) => (runtimeModels.includes(previous) ? previous : runtimeModels[0]));
          return;
        }
        setModels([]);
        setSelectedModel(runtimeTarget.model || "local-model");
      })
      .catch(() => {
        setModels([]);
        setSelectedModel(runtimeTarget.model || "local-model");
      });
  }, [isOpen, runtimeTarget]);

  useEffect(() => {
    const applySettings = () => {
      const next = resolveRuntimeTarget(loadRuntimeSettings());
      setRuntimeTarget(next);
      setSelectedModel(next.model || "local-model");
    };
    window.addEventListener(SETTINGS_EVENT, applySettings);
    window.addEventListener("storage", applySettings);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, applySettings);
      window.removeEventListener("storage", applySettings);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("panel-open");
      return;
    }

    document.body.classList.remove("panel-open");
    setOverlayVisible(false);
    setOverlayContent("");
    setOverlayTitle("");
    setIsRunning(false);
    streamRef.current?.abort();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !repo || !actionPrompt || !autoRunAction) return;
    if (lastActionRef.current === actionPrompt) return;
    lastActionRef.current = actionPrompt;
    runAction(actionPrompt, "Quick action");
    onActionConsumed?.();
  }, [actionPrompt, autoRunAction, isOpen, onActionConsumed, repo, runAction]);

  return (
    <div className={`readme-panel ${isOpen ? "open" : ""}`}>
      <div className="panel-header">
        <div className="readme-header-left">
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
          {repo ? (
            <a href={aboutUrl} target="_blank" rel="noopener noreferrer" className="readme-repo-link">
              Visit Repo <ExternalLink size={16} />
            </a>
          ) : null}
        </div>
        <div className="readme-header-right">
          <span>Model</span>
          <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
            {(models.length > 0 ? models : [runtimeTarget.model || "local-model"]).map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="readme-actions-header">
        {actionPresets.map((action) => (
          <button
            key={action.label}
            className={`action-btn ${action.variant === "primary" ? "primary" : ""}`}
            onClick={() => runAction(action.prompt, action.title, action.actionKind, action.actionParameters, action.write)}
          >
            {action.variant === "primary" ? <Wand2 size={14} /> : <Sparkles size={14} />} {action.label}
          </button>
        ))}
      </div>

      <div className="readme-content">
        <div className="readme-frame">
          <div className="readme-scroll">
            {loading ? <p>Loading...</p> : <div dangerouslySetInnerHTML={{ __html: content }} />}
          </div>

          {overlayVisible && (
            <div className="readme-overlay">
              <div className="readme-overlay-card">
                <div className="readme-overlay-title">{overlayTitle}</div>
                {activeRoute ? (
                  <div className="text-muted" style={{ marginBottom: 12 }}>
                    {activeRoute.label} · {activeRoute.capability}
                  </div>
                ) : null}
                <div className="readme-overlay-body">
                  {overlayContent || (isRunning ? "Working..." : "Ready")}
                </div>
                {!isRunning && (
                  <button className="action-btn" onClick={() => setOverlayVisible(false)}>
                    Close
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="readme-chat">
          <div className="readme-chat-log">
            {messages.map((message) => (
              <div key={message.id} className={`chat-bubble ${message.role}`}>
                {message.content}
              </div>
            ))}
          </div>
          <div className="readme-chat-input">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about this repo..."
              onKeyDown={(event) => {
                if (event.key === "Enter" && input.trim()) {
                  runAction(input.trim(), "Custom request");
                  setInput("");
                }
              }}
            />
            <button
              className="action-btn"
              onClick={() => {
                if (!input.trim()) return;
                runAction(input.trim(), "Custom request");
                setInput("");
              }}
            >
              Ask
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
