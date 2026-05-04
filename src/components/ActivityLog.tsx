import React, { useEffect, useState } from "react";
import { AgentEvent, getEventHouseId } from "@agent-events";
import { logger } from "../lib/logger";
import { Download, Activity, Server, Database } from "lucide-react";

const EVENT_BUS_URL = import.meta.env.VITE_EVENT_BUS_URL || "/bus";
const EVENT_BUS_SSE_URL = `${EVENT_BUS_URL}/events?house=vega-lab`;

type AgentEventWithDetails = AgentEvent & {
  data?: unknown;
  tool_name?: string;
  response_id?: string;
};

function renderEventDetails(event: AgentEvent) {
  const typedEvent = event as AgentEventWithDetails;

  if (typedEvent.data !== undefined) {
    return JSON.stringify(typedEvent.data);
  }
  if (typeof typedEvent.tool_name === "string") {
    return `Call: ${typedEvent.tool_name}`;
  }
  if (typeof typedEvent.response_id === "string") {
    return `Resp: ${typedEvent.response_id}`;
  }
  return JSON.stringify(event);
}

function normalizeSseEvent(payload: unknown): AgentEvent | null {
  if (!payload || typeof payload !== "object") return null;

  const eventEnvelope = payload as {
    type?: string;
    source_house?: string;
    timestamp?: string;
    payload?: { event?: AgentEvent; [key: string]: unknown };
  };

  if (eventEnvelope.payload?.event?.type) {
    return eventEnvelope.payload.event;
  }

  if (typeof eventEnvelope.type === "string") {
    return {
      type: eventEnvelope.type,
      house_id: eventEnvelope.source_house || getEventHouseId(eventEnvelope as AgentEvent),
      timestamp: eventEnvelope.timestamp || new Date().toISOString(),
      data: eventEnvelope.payload,
    };
  }

  return null;
}

export const ActivityLog: React.FC = () => {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    setEvents(logger.getCachedEvents());

    const eventSource = new EventSource(EVENT_BUS_SSE_URL);

    eventSource.onopen = () => {
      setIsConnected(true);
      console.log("Connected to Event Bus SSE");
    };

    const handleMessage = (message: MessageEvent<string>) => {
      try {
        const event = normalizeSseEvent(JSON.parse(message.data));
        if (!event) return;
        setEvents((previous) => [event, ...previous.slice(0, 199)]);
        logger.saveToLocalCache(event);
      } catch (error) {
        console.error("Failed to parse SSE event", error);
      }
    };

    eventSource.onmessage = handleMessage;
    eventSource.addEventListener("context.share", handleMessage as EventListener);
    eventSource.addEventListener("ping", () => {
      setIsConnected(true);
    });

    eventSource.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const filteredEvents = events.filter((event) =>
    filterType === "all"
    || event.type === filterType
    || (filterType === "vega-lab" && event.type.startsWith("vega-lab:"))
    || (filterType === "vega-lab" && event.type.startsWith("git-stars:"))
  );

  const downloadJson = () => {
    const jsonString = JSON.stringify(events, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `vega-lab-activity-${new Date().toISOString()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getEventIcon = (type: string) => {
    if (type.startsWith("vega-lab") || type.startsWith("git-stars")) return <Activity size={16} className="text-blue-500" />;
    if (type.startsWith("response")) return <Server size={16} className="text-purple-500" />;
    if (type.startsWith("tool")) return <Database size={16} className="text-orange-500" />;
    return <Activity size={16} className="text-gray-400" />;
  };

  return (
    <div className="activity-container">
      <div className="activity-header">
        <div>
          <h2 className="stats-header" style={{ marginBottom: 0 }}>
            Activity Stream
            {isConnected
              ? <span className="status-badge live">Live</span>
              : <span className="status-badge offline">Cached (Offline)</span>}
          </h2>
          <p className="text-muted">Real-time events from the Vega Lab orchestrator and core-x ecosystem</p>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          <select
            value={filterType}
            onChange={(event) => setFilterType(event.target.value)}
            className="filter-select"
          >
            <option value="all">All Events</option>
            <option value="vega-lab">Vega Lab Custom</option>
            <option value="response.completed">Response Completed</option>
            <option value="tool.call">Tool Calls</option>
          </select>
          <button
            onClick={downloadJson}
            className="action-btn"
            style={{ padding: "0 16px" }}
          >
            <Download size={16} /> Export JSON
          </button>
        </div>
      </div>

      <div className="activity-table-wrapper">
        <table className="activity-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>House</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: "32px", textAlign: "center", color: "#94a3b8" }}>
                  No events found. Stream is waiting for emissions.
                </td>
              </tr>
            ) : (
              filteredEvents.map((event, index) => (
                <tr key={index}>
                  <td style={{ fontFamily: "monospace" }} className="text-muted">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {getEventIcon(event.type)}
                      {event.type}
                    </div>
                  </td>
                  <td>
                    <span className="chip chip-tag">
                      {getEventHouseId(event)}
                    </span>
                  </td>
                  <td className="text-muted" style={{ maxWidth: "400px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {renderEventDetails(event)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
