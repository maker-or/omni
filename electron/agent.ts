/**
 * ACP agent entry — re-exports AgentConnectionManager as AgentManager
 * so main.ts and other consumers keep working during the migration.
 */
export { AgentConnectionManager, AgentManager } from "./agent-connection-manager.ts";
