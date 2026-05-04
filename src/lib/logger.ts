import { AgentEvent, createCustomEvent, HouseId } from '@agent-events';
import { Repo } from '../types';

const EVENT_BUS_URL = import.meta.env.VITE_EVENT_BUS_URL || '/bus';
const HOUSE_ID: HouseId = 'vega-lab';
const CACHE_KEY = 'vega-lab:activity-cache';
const LEGACY_CACHE_KEY = 'git-stars:activity-cache';

// Standard event types for this house
const REPO_VIEWED_TYPE = 'repo.viewed';

interface RepoViewDetails {
  nwo: string; // name with owner
  url: string;
  source: 'card' | 'table';
}

function toEventBusMessage(event: AgentEvent) {
  return {
    message_id: `vega-lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'context.share',
    source_house: HOUSE_ID,
    target: { broadcast: true },
    payload: { event },
    timestamp: event.timestamp || new Date().toISOString(),
  };
}

/**
 * Logger service that emits to the central Event Bus
 * and optionally caches locally for offline support.
 */
export const logger = {
  /**
   * Log an event to the Event Bus (Authoritative Source)
   */
  async logEvent(event: AgentEvent) {
    this.saveToLocalCache(event);

    try {
      await fetch(`${EVENT_BUS_URL}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toEventBusMessage(event)),
      });
    } catch {
      // Offline mode is expected during local UI work. The local cache above is authoritative until SSE reconnects.
    }
  },

  /**
   * Save to local storage as a cache/fallback
   */
  saveToLocalCache(event: AgentEvent) {
    try {
      const stored = localStorage.getItem(CACHE_KEY) || localStorage.getItem(LEGACY_CACHE_KEY);
      const events: AgentEvent[] = stored ? JSON.parse(stored) : [];
      events.unshift(event); // Newest first
      // Keep only last 100 for cache
      if (events.length > 100) events.length = 100;
      localStorage.setItem(CACHE_KEY, JSON.stringify(events));
    } catch (e) {
      console.error('Failed to save to local cache', e);
    }
  },

  /**
   * Factory: Create a 'repo.viewed' custom event
   */
  createRepoViewEvent(repo: Repo, source: 'card' | 'table'): AgentEvent {
    const details: RepoViewDetails = {
      nwo: `${repo.author}/${repo.name}`,
      url: repo.url,
      source
    };
    return createCustomEvent(HOUSE_ID, REPO_VIEWED_TYPE, details);
  },

  /**
   * Get events for initial view (merges local cache in case of offline)
   * Real-time updates should come from SSE.
   */
  getCachedEvents(): AgentEvent[] {
    try {
      const stored = localStorage.getItem(CACHE_KEY) || localStorage.getItem(LEGACY_CACHE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }
};
