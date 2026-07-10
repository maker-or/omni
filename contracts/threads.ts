export interface Thread {
  id: string;
  project_id: string;
  /** Which ACP agent owns this thread (e.g. "cursor-acp@1.0"). */
  agent_id: string;
  /** ACP session.id from session/new (or session/resume). */
  agent_session_id: string;
  /** Nullable until agent sends session_info_update. */
  title: string | null;
  sort_order?: number | null;
  created_at: number;
  last_used_at: number;
}

export type NewThread = Omit<Thread, "id">;

export interface ThreadPage {
  threads: Thread[];
  hasMore: boolean;
  nextOffset: number;
}

export interface OpenTabsState {
  openThreadIds: string[];
  activeThreadId: string | null;
  threadSwitchHistory: string[];
}
