export interface Thread {
  id: string;
  project_id: string;
  title: string;
  session_file: string | null;
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
