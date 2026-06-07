export interface Project {
  id: string;
  path: string;
  name: string;
  icon: string | null;
}

export type NewProject = Omit<Project, "id">;
