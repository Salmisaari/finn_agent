// lib/ace/types.ts
// Shared types for Finn's supplier intelligence system

// ========================================
// CALLER CONTEXT
// ========================================

export type Channel = 'slack';  // Finn is internal-only

export interface CallerContext {
  channel: Channel;
  requestingUserId: string;
  slackChannel: string;
  slackThreadTs: string;
  supplierHint?: string;
  pipedriveOrgId?: number;
}

// ========================================
// GENERATOR TYPES
// ========================================

export interface GeneratorInput {
  slackMessage: string;
  requestingUser: string;
  callerContext: CallerContext;
  /** Supplier names extracted inline from the query */
  supplierNames?: string[];
}

export interface GeneratorOutput {
  response: string;
  toolCalls: ToolCall[];
  success: boolean;
  error?: string;
  loopCount?: number;
}

// ========================================
// TOOL TYPES
// ========================================

export interface ToolCall {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  success: boolean;
  error?: string;
  timestamp: Date;
}

export interface ToolCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
