export interface Thread {
  id: string;
  project_id: string;
  title: string;
  session_file: string | null;
}

export type NewThread = Omit<Thread, "id">;
