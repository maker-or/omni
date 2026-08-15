/**
 * Tokenized composer content for draft thread creation and live @-mentions.
 *
 * Entity tokens (project / agent / model) are control chips — they bind creation
 * or runtime config. Only text tokens become the prompt sent to the agent.
 */

export type ComposerTextToken = {
  kind: "text";
  text: string;
};

export type ComposerProjectToken = {
  kind: "project";
  id: string;
  label: string;
  /** Project icon name if known. */
  icon?: string | null;
};

export type ComposerAgentToken = {
  kind: "agent";
  id: string;
  label: string;
};

export type ComposerModelToken = {
  kind: "model";
  id: string;
  label: string;
  /** Agent that owns this model, when known (draft hierarchical pick). */
  agentId?: string;
  /** Provider identifier for logo rendering. */
  providerId?: string;
};

export type ComposerEntityToken = ComposerProjectToken | ComposerAgentToken | ComposerModelToken;

export type ComposerToken = ComposerTextToken | ComposerEntityToken;

export type ComposerContent = ComposerToken[];

/**
 * Mention kinds the intelligent `@` system can open.
 * - project / agent / model → control chips
 * - file → inserted as plain `@path` text (not a chip)
 */
export type ComposerMentionKind = "project" | "agent" | "model" | "file";

/** In-progress draft thread (no thread id yet). */
export type DraftState = {
  projectId: string | null;
  agentId: string | null;
  modelId: string | null;
  /** Worktree path for the draft's project, when the user (or chrome) set one. */
  worktreePath: string | null;
  /** Composer has non-empty text or user-edited tokens beyond soft defaults. */
  dirty: boolean;
  /**
   * Ambient active project id when the draft started, so we can restore it if
   * the draft soft-synced activeProject and is discarded without creating.
   */
  previousActiveProjectId: string | null;
  /** Soft-default project chip was auto-inserted from ambient active project. */
  softDefaultProject: boolean;
};

/** Renderer → main payload when a draft is committed on send. */
export type ThreadCreateRequest = {
  projectId: string;
  agentId: string;
  modelId: string | null;
  worktreePath: string | null;
  textContent: string;
  title?: string | null;
};
