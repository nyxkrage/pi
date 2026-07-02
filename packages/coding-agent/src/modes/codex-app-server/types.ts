// Wire format types matching Codex app-server JSON-RPC protocol

export type RequestId = string | number;

export interface JSONRPCRequest {
	id: RequestId;
	method: string;
	params?: unknown;
}

export interface JSONRPCNotification {
	method: string;
	params?: unknown;
}

export interface JSONRPCResponse {
	id: RequestId;
	result: unknown;
}

export interface JSONRPCErrorError {
	code: number;
	message: string;
	data?: unknown;
}

export interface JSONRPCError {
	id: RequestId;
	error: JSONRPCErrorError;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResponse | JSONRPCError;

// ============================================================================
// Initialize
// ============================================================================

export interface ClientInfo {
	name: string;
	title?: string | null;
	version?: string;
}

export interface InitializeCapabilities {
	streaming?: boolean;
	experimentalApi?: string[];
	dynamicTools?: boolean;
	multiprocessing?: boolean;
}

export interface InitializeParams {
	clientInfo: ClientInfo;
	capabilities?: InitializeCapabilities | null;
}

export interface InitializeResponse {
	userAgent: string;
	serverInfo: { name: string; version: string };
	serverCapabilities: Record<string, unknown>;
	authStatus: { isLoggedIn: boolean };
	config: Record<string, unknown>;
}

// ============================================================================
// Thread types
// ============================================================================

export type ThreadStatusType =
	| { type: "notLoaded" }
	| { type: "idle" }
	| { type: "systemError" }
	| { type: "active"; activeFlags: string[] };

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export interface Turn {
	id: string;
	items: ThreadItem[];
	itemsView: TurnItemsView;
	status: TurnStatus;
	error: TurnError | null;
	startedAt: number | null;
	completedAt: number | null;
	durationMs: number | null;
}

export interface TurnError {
	code: string;
	message: string;
}

export type TurnItemsView = "full" | "partial" | "minimal";

export interface ThreadItem {
	id: string;
	type: string;
	[key: string]: unknown;
}

export interface Thread {
	id: string;
	sessionId: string;
	preview: string;
	ephemeral: boolean;
	modelProvider: string;
	createdAt: number;
	updatedAt: number;
	status: ThreadStatusType;
	path: string | null;
	cwd: string;
	cliVersion: string;
	source: string;
	name: string | null;
	turns: Turn[];
}

export interface ThreadStartParams {
	model?: string | null;
	modelProvider?: string | null;
	cwd?: string | null;
	baseInstructions?: string | null;
	ephemeral?: boolean | null;
}

export interface ThreadStartResponse {
	thread: Thread;
	model: string;
	modelProvider: string;
	cwd: string;
}

export interface ThreadListParams {
	cursor?: string | null;
	limit?: number | null;
	cwd?: string | string[] | null;
	searchTerm?: string | null;
}

export interface ThreadListResponse {
	data: Thread[];
	nextCursor: string | null;
}

export interface ThreadReadParams {
	threadId: string;
	includeTurns: boolean;
}

export interface ThreadReadResponse {
	thread: Thread;
}

// ============================================================================
// Turn types
// ============================================================================

export type UserInput =
	| { type: "text"; text: string }
	| { type: "image"; url: string }
	| { type: "localImage"; path: string };

export interface TurnStartParams {
	threadId: string;
	input: UserInput[];
	cwd?: string | null;
	model?: string | null;
}

export interface TurnStartResponse {
	turn: Turn;
}

export interface TurnSteerParams {
	threadId: string;
	input: UserInput[];
	expectedTurnId: string;
}

export interface TurnSteerResponse {
	turnId: string;
}

export interface TurnInterruptParams {
	threadId: string;
	turnId: string;
}

// ============================================================================
// FS types
// ============================================================================

export interface FsReadFileParams {
	path: string;
}

export interface FsReadFileResponse {
	dataBase64: string;
}

export interface FsWriteFileParams {
	path: string;
	dataBase64: string;
}

export interface FsReadDirectoryParams {
	path: string;
}

export interface FsReadDirectoryEntry {
	fileName: string;
	isDirectory: boolean;
	isFile: boolean;
}

export interface FsReadDirectoryResponse {
	entries: FsReadDirectoryEntry[];
}

export interface FsRemoveParams {
	path: string;
	recursive?: boolean | null;
	force?: boolean | null;
}

export interface FsGetMetadataParams {
	path: string;
}

export interface FsGetMetadataResponse {
	isDirectory: boolean;
	isFile: boolean;
	isSymlink: boolean;
	createdAtMs: number;
	modifiedAtMs: number;
}

// ============================================================================
// Command exec types
// ============================================================================

export interface CommandExecParams {
	command: string[];
	processId?: string | null;
	tty?: boolean;
	streamStdin?: boolean;
	streamStdoutStderr?: boolean;
	cwd?: string | null;
	env?: Record<string, string | null> | null;
	timeoutMs?: number | null;
	disableTimeout?: boolean;
}

export interface CommandExecResponse {
	exitCode: number;
	stdout: string;
	stderr: string;
}

// ============================================================================
// Config types
// ============================================================================

export interface ConfigReadParams {
	includeLayers: boolean;
	cwd?: string | null;
}

export interface ConfigReadResponse {
	config: Record<string, unknown>;
}

export interface ConfigValueWriteParams {
	keyPath: string;
	value: unknown;
}

// ============================================================================
// Model types
// ============================================================================

export interface ModelInfo {
	id: string;
	model: string;
	displayName: string;
	provider: string;
	hidden: boolean;
}

export interface ModelListResponse {
	data: ModelInfo[];
	nextCursor: string | null;
}

// ============================================================================
// Notifications
// ============================================================================

export interface CommandExecOutputDeltaNotification {
	processId: string;
	stream: "stdout" | "stderr";
	deltaBase64: string;
}

// ============================================================================
// Server notifications (sent server -> client)
// ============================================================================

export interface ServerNotification {
	method: string;
	params: unknown;
}

// Error codes
export const ERROR_CODES = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	SERVER_OVERLOADED: -32001,
} as const;
