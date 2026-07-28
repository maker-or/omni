export interface Project {
  id: string;
  path: string;
  name: string;
  icon: string | null;
}

export type ProjectFileGitStatus =
  | "added"
  | "deleted"
  | "ignored"
  | "modified"
  | "renamed"
  | "untracked";

export interface ProjectFileTreeSnapshot {
  paths: string[];
  gitStatus: Array<{
    path: string;
    status: ProjectFileGitStatus;
  }>;
}

export type NewProject = Omit<Project, "id">;
