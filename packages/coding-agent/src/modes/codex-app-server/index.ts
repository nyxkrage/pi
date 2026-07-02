import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { attachJsonlLineReader, serializeJsonLine } from "../rpc/jsonl.ts";
import { MethodHandlers } from "./handlers.ts";
import type { JSONRPCError, JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, RequestId } from "./types.ts";
import { ERROR_CODES } from "./types.ts";

function isRequest(msg: JSONRPCMessage): msg is JSONRPCRequest & { method: string } {
	return "id" in msg && "method" in msg;
}

function makeSuccess(id: RequestId, result: unknown): JSONRPCResponse {
	return { id, result };
}

function makeError(id: RequestId, code: number, message: string): JSONRPCError {
	return { id, error: { code, message } };
}

function makeErrorResponse(id: RequestId, code: number, message: string): string {
	return serializeJsonLine(makeError(id, code, message));
}

function makeNotification(method: string, params: unknown): string {
	return serializeJsonLine({ method, params });
}

export async function runCodexAppServerMode(runtimeHost: AgentSessionRuntime): Promise<never> {
	takeOverStdout();
	let session = runtimeHost.session;

	const handlers = new MethodHandlers(runtimeHost);
	let unsubscribe: (() => void) | undefined;
	let shuttingDown = false;
	const signalCleanupHandlers: Array<() => void> = [];
	let detachInput = () => {};

	const sendNotification = (method: string, params: unknown) => {
		writeRawStdout(makeNotification(method, params));
	};

	const handleClientRequest = async (request: JSONRPCRequest): Promise<string | null> => {
		const { id, method, params } = request;

		try {
			let result: unknown;

			switch (method) {
				case "initialize":
					result = await handlers.handleInitialize(params as any);
					break;

				case "thread/create":
				case "thread/start":
					result = await handlers.handleThreadStart(params as any);
					break;

				case "thread/list":
					result = await handlers.handleThreadList(params as any);
					break;

				case "thread/read":
					result = await handlers.handleThreadRead(params as any);
					break;

				case "turn/start":
					result = await handlers.handleTurnStart(params as any);
					break;

				case "turn/reply":
					result = await handlers.handleTurnReply(params as any);
					break;

				case "turn/steer":
					result = await handlers.handleTurnSteer(params as any);
					break;

				case "turn/stop":
				case "turn/interrupt":
					result = await handlers.handleTurnInterrupt(params as any);
					break;

				case "fs/readFile":
				case "fs/read":
					result = await handlers.handleFsReadFile(params as any);
					break;

				case "fs/writeFile":
				case "fs/write":
					result = await handlers.handleFsWriteFile(params as any);
					break;

				case "fs/readDirectory":
				case "fs/list":
					result = await handlers.handleFsReadDirectory(params as any);
					break;

				case "fs/remove":
				case "fs/delete":
					result = await handlers.handleFsRemove(params as any);
					break;

				case "fs/getMetadata":
				case "fs/exists":
					result = await handlers.handleFsGetMetadata(params as any);
					break;

				case "command/exec":
					result = await handlers.handleCommandExec(params as any);
					break;

				case "config/read":
					result = await handlers.handleConfigRead(params as any);
					break;

				case "models/list":
				case "model/list":
					result = await handlers.handleModelList();
					break;

				case "auth/status":
					result = { isLoggedIn: true };
					break;

				default:
					return serializeJsonLine(makeError(id, ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`));
			}

			return serializeJsonLine(makeSuccess(id, result ?? {}));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return serializeJsonLine(makeError(id, ERROR_CODES.INTERNAL_ERROR, message));
		}
	};

	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			writeRawStdout(makeErrorResponse("null" as any, ERROR_CODES.PARSE_ERROR, "Parse error"));
			await waitForRawStdoutBackpressure();
			return;
		}

		const msg = parsed as JSONRPCMessage;

		if (isRequest(msg)) {
			const response = await handleClientRequest(msg);
			if (response) {
				writeRawStdout(response);
				await waitForRawStdoutBackpressure();
			}
		}
	};

	const rebindSession = () => {
		session = runtimeHost.session;
		unsubscribe?.();

		unsubscribe = session.subscribe((event) => {
			if (event.type === "turn_start") {
				sendNotification("turn/started", { threadId: session.sessionId });
			} else if (event.type === "turn_end") {
				const msg = event.message;
				const turnId = msg && "responseId" in msg ? msg.responseId : undefined;
				sendNotification("turn/completed", { threadId: session.sessionId, turnId: turnId ?? "" });
			} else if (event.type === "agent_start") {
				sendNotification("thread/started", { threadId: session.sessionId });
			} else if (event.type === "agent_end") {
				sendNotification("thread/status/changed", {
					threadId: session.sessionId,
					status: { type: "idle" },
				});
			} else if (event.type === "message_start") {
				const msg = event.message;
				const role = msg.role;
				const itemId = "responseId" in msg ? msg.responseId : undefined;
				if (role === "assistant") {
					sendNotification("item/started", { threadId: session.sessionId, itemId: itemId ?? "" });
				}
			} else if (event.type === "message_update") {
				const msg = event.message;
				if (msg.role === "assistant") {
					const ev = event.assistantMessageEvent;
					const delta = ev.type === "text_delta" ? ev.delta : "";
					sendNotification("item/agentMessage/delta", {
						threadId: session.sessionId,
						delta,
					});
				}
			} else if (event.type === "message_end") {
				const msg = event.message;
				const itemId = "responseId" in msg ? msg.responseId : undefined;
				if (msg.role === "assistant") {
					sendNotification("item/completed", { threadId: session.sessionId, itemId: itemId ?? "" });
				}
			}
		});
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
		if (shuttingDown) {
			process.exit(exitCode);
		}
		shuttingDown = true;
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		unsubscribe?.();
		await runtimeHost.dispose();
		detachInput();
		process.stdin.pause();
		if (signal !== "SIGTERM") {
			await flushRawStdout();
		}
		process.exit(exitCode);
	}

	rebindSession();
	registerSignalHandlers();

	const onInputEnd = () => {
		void shutdown();
	};
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
			void handleInputLine(line);
		});
		return () => {
			detachJsonl();
			process.stdin.off("end", onInputEnd);
		};
	})();

	return new Promise(() => {});
}
