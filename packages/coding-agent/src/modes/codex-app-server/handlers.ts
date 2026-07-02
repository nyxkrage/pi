import * as fs from "node:fs";
import * as path from "node:path";
import { VERSION } from "../../config.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type {
	CommandExecParams,
	CommandExecResponse,
	ConfigReadParams,
	ConfigReadResponse,
	FsGetMetadataParams,
	FsGetMetadataResponse,
	FsReadDirectoryEntry,
	FsReadDirectoryParams,
	FsReadDirectoryResponse,
	FsReadFileParams,
	FsReadFileResponse,
	FsRemoveParams,
	FsWriteFileParams,
	InitializeParams,
	InitializeResponse,
	ModelInfo,
	ModelListResponse,
	Thread,
	ThreadListParams,
	ThreadListResponse,
	ThreadReadParams,
	ThreadReadResponse,
	ThreadStartParams,
	ThreadStartResponse,
	Turn,
	TurnInterruptParams,
	TurnStartParams,
	TurnStartResponse,
	TurnStatus,
	TurnSteerParams,
	TurnSteerResponse,
	UserInput,
} from "./types.ts";

function generateId(): string {
	return crypto.randomUUID();
}

function nowUnix(): number {
	return Math.floor(Date.now() / 1000);
}

function userInputToText(input: UserInput[]): string {
	return input.map((i) => (i.type === "text" ? i.text : "")).join("\n");
}

function makeTurn(id: string, status: TurnStatus, error?: string): Turn {
	return {
		id,
		items: [],
		itemsView: "minimal",
		status,
		error: error ? { code: "error", message: error } : null,
		startedAt: nowUnix(),
		completedAt: status !== "inProgress" ? nowUnix() : null,
		durationMs: null,
	};
}

function buildThread(
	sessionId: string,
	sessionName: string | undefined,
	sessionFile: string | undefined,
	cwd: string,
	modelProvider: string,
	isStreaming: boolean,
	created: number,
	now: number,
	activeTurnId?: string,
): Thread {
	const thread: Thread = {
		id: sessionId,
		sessionId,
		preview: "",
		ephemeral: false,
		modelProvider,
		createdAt: created,
		updatedAt: now,
		status: isStreaming ? { type: "active" as const, activeFlags: ["running"] } : { type: "idle" as const },
		path: sessionFile ?? null,
		cwd,
		cliVersion: VERSION,
		source: "appServer",
		name: sessionName ?? null,
		turns: [],
	};
	if (activeTurnId) {
		thread.turns = [makeTurn(activeTurnId, isStreaming ? "inProgress" : "completed")];
	}
	return thread;
}

export class MethodHandlers {
	private _defaultRuntime: AgentSessionRuntime;
	private _activeTurns = new Map<string, string>();
	private _sessionInfo = new Map<string, { created: number }>();

	constructor(runtime: AgentSessionRuntime) {
		this._defaultRuntime = runtime;
	}

	async handleInitialize(_params: InitializeParams): Promise<InitializeResponse> {
		return {
			userAgent: `pi/${VERSION}`,
			serverInfo: { name: "pi-coding-agent", version: VERSION },
			serverCapabilities: {},
			authStatus: { isLoggedIn: true },
			config: {},
		};
	}

	async handleThreadStart(_params: ThreadStartParams): Promise<ThreadStartResponse> {
		const session = this._defaultRuntime.session;
		const sessionId = session.sessionId;

		this._sessionInfo.set(sessionId, { created: nowUnix() });

		const thread = buildThread(
			sessionId,
			session.sessionName,
			session.sessionFile,
			session.sessionManager.getCwd() ?? process.cwd(),
			session.model?.provider ?? "unknown",
			false,
			nowUnix(),
			nowUnix(),
		);

		return {
			thread,
			model: session.model?.name ?? "",
			modelProvider: session.model?.provider ?? "",
			cwd: process.cwd(),
		};
	}

	async handleThreadList(_params: ThreadListParams): Promise<ThreadListResponse> {
		const session = this._defaultRuntime.session;
		const sessionId = session.sessionId;
		const info = this._sessionInfo.get(sessionId);

		const thread = buildThread(
			sessionId,
			session.sessionName,
			session.sessionFile,
			session.sessionManager.getCwd() ?? process.cwd(),
			session.model?.provider ?? "unknown",
			session.isStreaming,
			info?.created ?? nowUnix(),
			nowUnix(),
			this._activeTurns.get(sessionId),
		);

		return { data: [thread], nextCursor: null };
	}

	async handleThreadRead(params: ThreadReadParams): Promise<ThreadReadResponse> {
		const session = this._defaultRuntime.session;
		const sessionId = params.threadId;
		const info = this._sessionInfo.get(sessionId);

		const thread = buildThread(
			sessionId,
			session.sessionName,
			session.sessionFile,
			session.sessionManager.getCwd() ?? process.cwd(),
			session.model?.provider ?? "unknown",
			session.isStreaming,
			info?.created ?? nowUnix(),
			nowUnix(),
			params.includeTurns ? this._activeTurns.get(sessionId) : undefined,
		);

		return { thread };
	}

	async handleTurnStart(params: TurnStartParams): Promise<TurnStartResponse> {
		const session = this._defaultRuntime.session;
		const sessionId = params.threadId;
		const turnId = generateId();
		const text = userInputToText(params.input);

		this._activeTurns.set(sessionId, turnId);

		if (params.model) {
			const available = await session.modelRegistry.getAvailable();
			const model = available.find((m) => m.id === params.model || m.name === params.model);
			if (model) {
				await session.setModel(model);
			}
		}

		void session.prompt(text).catch(() => {});

		return { turn: makeTurn(turnId, "inProgress") };
	}

	async handleTurnSteer(params: TurnSteerParams): Promise<TurnSteerResponse> {
		const session = this._defaultRuntime.session;
		const text = userInputToText(params.input);

		this._activeTurns.set(params.threadId, params.expectedTurnId);

		await session.steer(text);

		return { turnId: params.expectedTurnId };
	}

	async handleTurnReply(params: TurnStartParams): Promise<TurnStartResponse> {
		const session = this._defaultRuntime.session;
		const sessionId = params.threadId;
		const turnId = generateId();
		const text = userInputToText(params.input);

		this._activeTurns.set(sessionId, turnId);

		void session.followUp(text).catch(() => {});

		return { turn: makeTurn(turnId, "inProgress") };
	}

	async handleTurnInterrupt(params: TurnInterruptParams): Promise<Record<string, never>> {
		const session = this._defaultRuntime.session;
		this._activeTurns.delete(params.threadId);
		await session.abort();
		return {};
	}

	async handleFsReadFile(params: FsReadFileParams): Promise<FsReadFileResponse> {
		const content = fs.readFileSync(params.path);
		return { dataBase64: content.toString("base64") };
	}

	async handleFsWriteFile(params: FsWriteFileParams): Promise<Record<string, never>> {
		const content = Buffer.from(params.dataBase64, "base64");
		fs.mkdirSync(path.dirname(params.path), { recursive: true });
		fs.writeFileSync(params.path, content);
		return {};
	}

	async handleFsReadDirectory(params: FsReadDirectoryParams): Promise<FsReadDirectoryResponse> {
		const entries = fs.readdirSync(params.path, { withFileTypes: true });
		return {
			entries: entries.map(
				(entry): FsReadDirectoryEntry => ({
					fileName: entry.name,
					isDirectory: entry.isDirectory(),
					isFile: entry.isFile(),
				}),
			),
		};
	}

	async handleFsRemove(params: FsRemoveParams): Promise<Record<string, never>> {
		const recursive = params.recursive !== false;
		const force = params.force !== false;

		try {
			fs.rmSync(params.path, { recursive, force });
		} catch (err) {
			if (!force) throw err;
		}
		return {};
	}

	async handleFsGetMetadata(params: FsGetMetadataParams): Promise<FsGetMetadataResponse> {
		const stat = fs.statSync(params.path);
		const lstat = fs.lstatSync(params.path);
		return {
			isDirectory: stat.isDirectory(),
			isFile: stat.isFile(),
			isSymlink: lstat.isSymbolicLink(),
			createdAtMs: stat.birthtimeMs,
			modifiedAtMs: stat.mtimeMs,
		};
	}

	async handleCommandExec(params: CommandExecParams): Promise<CommandExecResponse> {
		const command = params.command.join(" ");
		const result = await this._defaultRuntime.session.executeBash(command, undefined, {
			excludeFromContext: true,
		});

		return {
			exitCode: result.exitCode ?? 0,
			stdout: result.output,
			stderr: "",
		};
	}

	async handleConfigRead(_params: ConfigReadParams): Promise<ConfigReadResponse> {
		return { config: {} };
	}

	async handleModelList(): Promise<ModelListResponse> {
		const available = await this._defaultRuntime.session.modelRegistry.getAvailable();
		return {
			data: available.map(
				(m): ModelInfo => ({
					id: `${m.provider}/${m.name}`,
					model: m.name,
					displayName: `${m.provider}: ${m.name}`,
					provider: m.provider,
					hidden: false,
				}),
			),
			nextCursor: null,
		};
	}
}
