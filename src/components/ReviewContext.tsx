import React, { createContext, useContext, useReducer, ReactNode } from "react";
import type { ReviewArtifact } from "./ReviewPanel";

interface ReviewState {
  artifacts: {
    starSync: ReviewArtifact[];
    repoSignals: ReviewArtifact[];
    skillCandidates: ReviewArtifact[];
    techAlerts: ReviewArtifact[];
    houseIdeas: ReviewArtifact[];
  };
  filters: {
    type: string;
    visibility: string;
    search: string;
  };
  selection: Set<string>;
}

type Action =
  | { type: "SET_ARTIFACTS"; payload: ReviewState["artifacts"] }
  | { type: "SET_FILTER"; payload: Partial<ReviewState["filters"]> }
  | { type: "TOGGLE_SELECTION"; payload: string }
  | { type: "SELECT_ALL"; payload: string[] }
  | { type: "CLEAR_SELECTION" }
  | { type: "UPDATE_ARTIFACT_STATE"; payload: { id: string; newState: "accepted" | "rejected" | "pending" } }
  | { type: "BATCH_UPDATE_STATE"; payload: { ids: string[]; newState: "accepted" | "rejected" | "pending" } };

const initialState: ReviewState = {
  artifacts: {
    starSync: [],
    repoSignals: [],
    skillCandidates: [],
    techAlerts: [],
    houseIdeas: [],
  },
  filters: {
    type: "all",
    visibility: "all",
    search: "",
  },
  selection: new Set(),
};

function reviewReducer(state: ReviewState, action: Action): ReviewState {
  switch (action.type) {
    case "SET_ARTIFACTS":
      return { ...state, artifacts: action.payload };
    case "SET_FILTER":
      return { ...state, filters: { ...state.filters, ...action.payload } };
    case "TOGGLE_SELECTION": {
      const newSelection = new Set(state.selection);
      if (newSelection.has(action.payload)) {
        newSelection.delete(action.payload);
      } else {
        newSelection.add(action.payload);
      }
      return { ...state, selection: newSelection };
    }
    case "SELECT_ALL":
      return { ...state, selection: new Set(action.payload) };
    case "CLEAR_SELECTION":
      return { ...state, selection: new Set() };
    case "UPDATE_ARTIFACT_STATE": {
      const updateList = (list: ReviewArtifact[]) =>
        list.map((a) => (a.id === action.payload.id ? { ...a, review_state: action.payload.newState } : a));

      return {
        ...state,
        artifacts: {
          starSync: updateList(state.artifacts.starSync),
          repoSignals: updateList(state.artifacts.repoSignals),
          skillCandidates: updateList(state.artifacts.skillCandidates),
          techAlerts: updateList(state.artifacts.techAlerts),
          houseIdeas: updateList(state.artifacts.houseIdeas),
        },
      };
    }
    case "BATCH_UPDATE_STATE": {
      const updateList = (list: ReviewArtifact[]) =>
        list.map((a) => (action.payload.ids.includes(a.id) ? { ...a, review_state: action.payload.newState } : a));

      return {
        ...state,
        artifacts: {
          starSync: updateList(state.artifacts.starSync),
          repoSignals: updateList(state.artifacts.repoSignals),
          skillCandidates: updateList(state.artifacts.skillCandidates),
          techAlerts: updateList(state.artifacts.techAlerts),
          houseIdeas: updateList(state.artifacts.houseIdeas),
        },
        selection: new Set(), // clear selection after batch action
      };
    }
    default:
      return state;
  }
}

const ReviewContext = createContext<{
  state: ReviewState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reviewReducer, initialState);

  return (
    <ReviewContext.Provider value={{ state, dispatch }}>
      {children}
    </ReviewContext.Provider>
  );
}

export function useReview() {
  const context = useContext(ReviewContext);
  if (!context) {
    throw new Error("useReview must be used within a ReviewProvider");
  }
  return context;
}
