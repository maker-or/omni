export interface Thread {
  id: string;
  project_id: string;
  title: string;
}

export type NewThread = Omit<Thread, "id">;
