let activeProjectId: string | null = null;

export function setActiveProjectId(id: string): void {
  activeProjectId = id;
}

export function getActiveProjectId(): string | null {
  return activeProjectId;
}
