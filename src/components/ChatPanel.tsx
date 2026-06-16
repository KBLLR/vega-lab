import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader, Send, User as UserIcon, Wrench, X } from "lucide-react";
import type { Repo, VegaActionResult } from "../types";
import type { VegaLabRoute } from "../lib/orchestrator";
import {
  buildVegaLabTools,
  buildSystemPrompt,
  DEFAULT_AGENT_ID,
  HOUSE_ID,
  routeVegaLabIntent,
} from "../lib/orchestrator";
import {
  fetchVegaActionRuns,
  formatVegaActionResult,
  inferActionFromPrompt,
  runVegaAction,
  workflowStagesForRepo,
} from "../lib/action-bridge";
import type { OpenResponsesEvent } from "../lib/openresponses-client";
import { streamOpenResponses } from "../lib/openresponses-client";
import { fetchRuntimeModels } from "../lib/runtime-client";
import { loadRuntimeSettings, resolveRuntimeTarget, SETTINGS_EVENT } from "../lib/settings";

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  repo: Repo | null;
  agentId?: string;
  prefill?: string;
  autoSend?: boolean;
  onPrefillConsumed?: () => void;
  onRunComplete?: () => void;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status: "in_progress" | "done";
}

export function ChatPanel({
  isOpen,
  onClose,
  repo,
  agentId = DEFAULT_AGENT_ID,
  prefill,
  autoSend = false,
  onPrefillConsumed,
  onRunComplete,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCall>>({});
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [activeRoute, setActiveRoute] = useState<VegaLabRoute | null>(null);
  const [workflowRuns, setWorkflowRuns] = useState<VegaActionResult[]>([]);
  const [actionRuntimeState, setActionRuntimeState] = useState<"unknown" | "connected" | "disconnected">("unknown");
  const [runtimeTarget, setRuntimeTarget] = useState(() =>
    resolveRuntimeTarget(loadRuntimeSettings()),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<AbortController | null>(null);
  const lastPrefillRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const repoSessionRef = useRef<string | null>(null);

  const tools = useMemo(() => buildVegaLabTools(), []);
  const activeMissionTarget = runtimeTarget.mode === "local" ? "mlx" : "codex";
  const repoSessionKey = repo ? `${repo.author}/${repo.name}` : null;
  const workflowStages = useMemo(() => workflowStagesForRepo(workflowRuns, repo), [repo, workflowRuns]);

  const refreshWorkflowRuns = useCallback(() => {
    if (!repoSessionKey) {
      setWorkflowRuns([]);
      setActionRuntimeState("unknown");
      return Promise.resolve();
    }
    return fetchVegaActionRuns()
      .then((runs) => {
        setWorkflowRuns(runs);
        setActionRuntimeState("connected");
      })
      .catch(() => {
        setWorkflowRuns([]);
        setActionRuntimeState("disconnected");
      });
  }, [repoSessionKey]);

  function getWelcomeMessages(currentRepo: Repo): Message[] {
    return [
      {
        id: `welcome-${currentRepo.author}-${currentRepo.name}`,
        role: "assistant",
        content: `Vega Lab repo chat ready for ${currentRepo.author}/${currentRepo.name}. I can route to specialists, call typed house tools, and keep this session scoped to this repo.`,
        timestamp: Date.now(),
      },
    ];
  }

  useEffect(() => {
    fetchRuntimeModels(runtimeTarget.busUrl)
      .then((models) => setDefaultModel(models[0] || runtimeTarget.model || null))
      .catch(() => undefined);
  }, [runtimeTarget.busUrl, runtimeTarget.model]);

  useEffect(() => {
    const applySettings = () => {
      setRuntimeTarget(resolveRuntimeTarget(loadRuntimeSettings()));
    };
    window.addEventListener(SETTINGS_EVENT, applySettings);
    window.addEventListener("storage", applySettings);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, applySettings);
      window.removeEventListener("storage", applySettings);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !repo || !repoSessionKey) return;
    streamRef.current?.abort();
    streamRef.current = null;
    const welcomeMessages = getWelcomeMessages(repo);
    repoSessionRef.current = repoSessionKey;
    messagesRef.current = welcomeMessages;
    lastPrefillRef.current = null;
    setInput("");
    setMessages(welcomeMessages);
    setToolCalls({});
    setActiveRoute(null);
    setIsLoading(false);
    void refreshWorkflowRuns();
  }, [isOpen, refreshWorkflowRuns, repo, repoSessionKey]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, toolCalls]);

  const handleClose = () => {
    streamRef.current?.abort();
    streamRef.current = null;
    onClose();
  };

  function handleStreamEvent(event: OpenResponsesEvent, assistantId: string) {
    if (event.type === "response.output_text.delta" && event.delta) {
      setMessages((previous) => {
        const nextMessages = previous.map((message) =>
          message.id === assistantId
            ? { ...message, content: `${message.content}${event.delta}` }
            : message,
        );
        messagesRef.current = nextMessages;
        return nextMessages;
      });
      return;
    }

    if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
      const callId = event.item.call_id || event.item_id || `call-${Date.now()}`;
      setToolCalls((previous) => ({
        ...previous,
        [callId]: {
          id: callId,
          name: event.item?.name || "tool",
          arguments: event.item?.arguments || "",
          status: "in_progress",
        },
      }));
      return;
    }

    if (event.type === "response.function_call_arguments.delta") {
      const callId = event.call_id || event.item_id;
      if (!callId || !event.delta) return;
      setToolCalls((previous) => {
        const existing = previous[callId] || {
          id: callId,
          name: "tool",
          arguments: "",
          status: "in_progress" as const,
        };
        return {
          ...previous,
          [callId]: {
            ...existing,
            arguments: `${existing.arguments}${event.delta}`,
          },
        };
      });
      return;
    }

    if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
      const callId = event.item.call_id || event.item_id;
      if (!callId) return;
      setToolCalls((previous) => ({
        ...previous,
        [callId]: {
          ...previous[callId],
          status: "done",
        },
      }));
    }
  }

  const handleSend = useCallback((override?: string) => {
    if (!repo) return;
    const content = (override ?? input).trim();
    if (!content) return;

    const route = routeVegaLabIntent(content);
    setActiveRoute(route);
    const bridgeAction = inferActionFromPrompt(content, activeMissionTarget);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    const assistantId = `assistant-${Date.now()}`;

    setInput("");
    setIsLoading(true);

    const repoKeyAtSend = `${repo.author}/${repo.name}`;
    const scopedMessages = repoSessionRef.current === repoKeyAtSend
      ? messagesRef.current
      : getWelcomeMessages(repo);

    const conversation = [
      { role: "system", content: buildSystemPrompt(repo, route) },
      ...scopedMessages.map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content },
    ];

    const nextMessages = [
      ...scopedMessages,
      userMessage,
      { id: assistantId, role: "assistant" as const, content: "", timestamp: Date.now() },
    ];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    streamRef.current?.abort();

    if (bridgeAction) {
      const callId = `vega-action-${Date.now()}`;
      setToolCalls((previous) => ({
        ...previous,
        [callId]: {
          id: callId,
          name: bridgeAction.actionKind,
          arguments: JSON.stringify({
            repo: `${repo.author}/${repo.name}`,
            parameters: bridgeAction.parameters || {},
            write: bridgeAction.write === true,
          }, null, 2),
          status: "in_progress",
        },
      }));

      runVegaAction({
        repo,
        actionKind: bridgeAction.actionKind,
        parameters: bridgeAction.parameters,
        write: bridgeAction.write,
      })
        .then((result) => {
          const formatted = formatVegaActionResult(result);
          setActionRuntimeState("connected");
          setMessages((previous) => {
            const updated = previous.map((message) =>
              message.id === assistantId ? { ...message, content: formatted } : message,
            );
            messagesRef.current = updated;
            return updated;
          });
          setToolCalls((previous) => ({
            ...previous,
            [callId]: {
              ...previous[callId],
              status: "done",
            },
          }));
          void refreshWorkflowRuns();
          onRunComplete?.();
        })
        .catch((error: Error) => {
          setActionRuntimeState("disconnected");
          setMessages((previous) => [
            ...previous.map((message) =>
              message.id === assistantId
                ? { ...message, content: `Tooling error: ${error.message}` }
                : message,
            ),
          ]);
          setToolCalls((previous) => ({
            ...previous,
            [callId]: {
              ...previous[callId],
              status: "done",
            },
          }));
        })
        .finally(() => setIsLoading(false));
      return;
    }

    streamRef.current = streamOpenResponses({
      endpoint: `${runtimeTarget.busUrl}${runtimeTarget.responsesPath}`,
      body: {
        model: runtimeTarget.model || defaultModel || "local-model",
        messages: conversation,
        agent_id: route.agentId || agentId,
        house_id: HOUSE_ID,
        task_kind: route.capability,
        target_repo: { author: repo.author, name: repo.name },
        required_capabilities: [route.capability, "tool_execution"],
        evidence_policy: "required",
        model_profile: runtimeTarget.modelProfile,
        tools,
        tool_choice: "auto",
      },
      onEvent: (event) => {
        handleStreamEvent(event, assistantId);
      },
      onComplete: () => {
        setIsLoading(false);
        onRunComplete?.();
      },
      onError: (error) => {
        setIsLoading(false);
        setMessages((previous) => [
          ...previous,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `Tooling error: ${error.message}`,
            timestamp: Date.now(),
          },
        ]);
      },
    });
  }, [activeMissionTarget, agentId, defaultModel, input, onRunComplete, refreshWorkflowRuns, repo, runtimeTarget, tools]);

  useEffect(() => {
    if (!isOpen || !prefill) return;
    const scopedPrefillKey = `${repoSessionKey || "none"}:${prefill}`;
    if (lastPrefillRef.current === scopedPrefillKey) return;

    lastPrefillRef.current = scopedPrefillKey;
    setInput(prefill);
    if (autoSend) {
      handleSend(prefill);
      onPrefillConsumed?.();
    }
  }, [autoSend, handleSend, isOpen, onPrefillConsumed, prefill, repoSessionKey]);

  if (!isOpen) return null;

  return (
    <div className="orchestrator-panel">
      <div className="orchestrator-header">
        <div className="orchestrator-title">
          <div className="orchestrator-icon">
            <Bot size={18} />
          </div>
          <div>
            <div className="orchestrator-name">Repo Chat</div>
            <div className="orchestrator-sub">{repo ? `${repo.author}/${repo.name}` : "No repo selected"}</div>
            {activeRoute ? (
              <div className="orchestrator-sub">{activeRoute.label} · {activeRoute.capability}</div>
            ) : null}
          </div>
        </div>
        <button onClick={handleClose} className="orchestrator-close">
          <X size={18} />
        </button>
      </div>

      <div className="orchestrator-actions">
        <button className="chip chip-tag" onClick={() => handleSend("Use get_repo_details and extract_repo_skills to produce a concise repo brief with adoption fit and next action.")}>Brief</button>
        <button className="chip chip-tag" onClick={() => handleSend(`Call generate_repo_ops_kit with target ${activeMissionTarget} and summarize the generated draft artifacts.`)}>Ops Kit</button>
        <button className="chip chip-tag" onClick={() => handleSend("Call update_research_queue with status queued and explain why this repo belongs in the research queue.")}>Queue</button>
        <button className="chip chip-tag" onClick={() => handleSend(`Call generate_repo_mission with target ${activeMissionTarget} and return the mission brief.`)}>Mission</button>
      </div>

      <div className="orchestrator-workflow">
        <div className={`orchestrator-runtime ${actionRuntimeState}`}>
          Action bridge: {actionRuntimeState === "connected" ? "connected" : actionRuntimeState === "disconnected" ? "disconnected" : "checking"}
        </div>
        <div className="workflow-stage-grid" aria-label="Vega durable action workflow">
          {workflowStages.map((stage) => (
            <div
              key={stage.id}
              className={`workflow-stage ${stage.state}`}
              title={stage.description}
            >
              <span className="workflow-stage__dot" />
              <span className="workflow-stage__label">{stage.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="orchestrator-messages">
        {messages.map((message) => (
          <div key={message.id} className={`message-row ${message.role}`}>
            <div className="message-avatar">
              {message.role === "assistant" ? <Bot size={16} /> : <UserIcon size={16} />}
            </div>
            <div className="message-bubble">{message.content}</div>
          </div>
        ))}
        {isLoading ? (
          <div className="message-row assistant">
            <div className="message-avatar">
              <Bot size={16} />
            </div>
            <div className="message-bubble loading">
              <Loader size={14} className="spin" /> Thinking...
            </div>
          </div>
        ) : null}
      </div>

      <div className="orchestrator-tools">
        <div className="tools-header">
          <Wrench size={14} /> Tool activity
        </div>
        <div className="tools-list">
          {Object.values(toolCalls).length === 0 ? (
            <div className="text-muted">No tool activity yet.</div>
          ) : (
            Object.values(toolCalls).map((call) => (
              <div key={call.id} className="tool-call">
                <div className="tool-call__header">
                  <strong>{call.name}</strong>
                  <span>{call.status === "done" ? "done" : "running"}</span>
                </div>
                <pre>{call.arguments || "{}"}</pre>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="orchestrator-input">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the orchestrator..."
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSend();
          }}
        />
        <button onClick={() => handleSend()} disabled={!input.trim() || isLoading}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
