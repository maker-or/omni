import { a as formatThrownValue, i as createAssistantMessageDiagnostic, l as clampThinkingLevel, o as registerSessionResourceCleanup, r as appendAssistantMessageDiagnostic, s as AssistantMessageEventStream } from "../index.js";
import { t as headersToRecord } from "./headers-B9hXwOSE.js";
import { r as buildBaseOptions } from "./transform-messages-Db9U73l0.js";
import { t as clampOpenAIPromptCacheKey } from "./openai-prompt-cache-Bc6qNWt0.js";
import { n as convertResponsesTools, r as processResponsesStream, t as convertResponsesMessages } from "./openai-responses-shared-HV82ni06.js";
//#region node_modules/@earendil-works/pi-ai/dist/utils/abort-signals.js
function combineAbortSignals(signals) {
	const activeSignals = signals.filter((signal) => signal !== void 0);
	if (activeSignals.length === 0) return { cleanup: () => {} };
	if (activeSignals.length === 1) return {
		signal: activeSignals[0],
		cleanup: () => {}
	};
	const controller = new AbortController();
	const listeners = [];
	const abort = (signal) => {
		if (!controller.signal.aborted) controller.abort(signal.reason);
	};
	for (const signal of activeSignals) {
		if (signal.aborted) {
			abort(signal);
			break;
		}
		const listener = () => abort(signal);
		signal.addEventListener("abort", listener, { once: true });
		listeners.push({
			signal,
			listener
		});
	}
	return {
		signal: controller.signal,
		cleanup: () => {
			for (const { signal, listener } of listeners) signal.removeEventListener("abort", listener);
		}
	};
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/providers/openai-codex-responses.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
var _os = null;
var dynamicImport = (specifier) => import(__rewriteRelativeImportExtension(specifier));
var NODE_OS_SPECIFIER = "node:os";
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) dynamicImport(NODE_OS_SPECIFIER).then((m) => {
	_os = m;
});
var DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
var JWT_CLAIM_PATH = "https://api.openai.com/auth";
var DEFAULT_MAX_RETRIES = 0;
var BASE_DELAY_MS = 1e3;
var DEFAULT_MAX_RETRY_DELAY_MS = 6e4;
var DEFAULT_SSE_HEADER_TIMEOUT_MS = 1e4;
var DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS = 15e3;
var CODEX_TOOL_CALL_PROVIDERS = new Set([
	"openai",
	"openai-codex",
	"opencode"
]);
var WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE = 1009;
var CODEX_RESPONSE_STATUSES = new Set([
	"completed",
	"incomplete",
	"failed",
	"cancelled",
	"queued",
	"in_progress"
]);
function isTerminalRateLimitError(errorText) {
	return /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i.test(errorText);
}
function isRetryableError(status, errorText) {
	if (status === 429 && isTerminalRateLimitError(errorText)) return false;
	if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
	return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(errorText);
}
function getRetryAfterDelayMs(headers) {
	const retryAfterMs = headers.get("retry-after-ms");
	if (retryAfterMs !== null) {
		const millis = Number(retryAfterMs);
		if (Number.isFinite(millis)) return Math.max(0, millis);
	}
	const retryAfter = headers.get("retry-after");
	if (!retryAfter) return;
	const seconds = Number(retryAfter);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
	const date = Date.parse(retryAfter);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
}
function capRetryDelayMs(delayMs, options) {
	const maxRetryDelayMs = options?.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
	return maxRetryDelayMs > 0 ? Math.min(delayMs, maxRetryDelayMs) : delayMs;
}
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(/* @__PURE__ */ new Error("Request was aborted"));
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timeout);
			reject(/* @__PURE__ */ new Error("Request was aborted"));
		});
	});
}
function normalizeTimeoutMs(value) {
	if (value === void 0) return void 0;
	if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid timeoutMs: ${String(value)}`);
	return Math.floor(value);
}
function createSSEHeaderTimeout() {
	const controller = new AbortController();
	let error;
	const timeout = setTimeout(() => {
		error = /* @__PURE__ */ new Error(`Codex SSE response headers timed out after ${DEFAULT_SSE_HEADER_TIMEOUT_MS}ms`);
		controller.abort(error);
	}, DEFAULT_SSE_HEADER_TIMEOUT_MS);
	return {
		signal: controller.signal,
		clear: () => clearTimeout(timeout),
		error: () => error
	};
}
var streamOpenAICodexResponses = (model, context, options) => {
	const stream = new AssistantMessageEventStream();
	(async () => {
		const output = {
			role: "assistant",
			content: [],
			api: "openai-codex-responses",
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0
				}
			},
			stopReason: "stop",
			timestamp: Date.now()
		};
		try {
			const apiKey = options?.apiKey;
			if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
			const accountId = extractAccountId(apiKey);
			let body = buildRequestBody(model, context, options);
			const nextBody = await options?.onPayload?.(body, model);
			if (nextBody !== void 0) body = nextBody;
			const websocketRequestId = options?.sessionId || createCodexRequestId();
			const sseHeaders = buildSSEHeaders(model.headers, options?.headers, accountId, apiKey, options?.sessionId);
			const websocketHeaders = buildWebSocketHeaders(model.headers, options?.headers, accountId, apiKey, websocketRequestId);
			const bodyJson = JSON.stringify(body);
			const idleTimeoutMs = normalizeTimeoutMs(options?.timeoutMs);
			const websocketConnectTimeoutMs = normalizeTimeoutMs(options?.websocketConnectTimeoutMs);
			const transport = options?.transport || "auto";
			const websocketDisabledForSession = transport !== "sse" && isWebSocketSseFallbackActive(options?.sessionId);
			if (websocketDisabledForSession) recordWebSocketSseFallback(options?.sessionId);
			if (transport !== "sse" && !websocketDisabledForSession) {
				let websocketStarted = false;
				try {
					await processWebSocketStream(resolveCodexWebSocketUrl(model.baseUrl), body, websocketHeaders, output, stream, model, () => {
						websocketStarted = true;
					}, idleTimeoutMs, websocketConnectTimeoutMs, options);
					if (options?.signal?.aborted) throw new Error("Request was aborted");
					stream.push({
						type: "done",
						reason: output.stopReason,
						message: output
					});
					stream.end();
					return;
				} catch (error) {
					if (options?.signal?.aborted || isCodexNonTransportError(error)) throw error;
					appendAssistantMessageDiagnostic(output, createAssistantMessageDiagnostic("provider_transport_failure", error, {
						configuredTransport: transport,
						fallbackTransport: websocketStarted ? void 0 : "sse",
						eventsEmitted: websocketStarted,
						phase: websocketStarted ? "after_message_stream_start" : "before_message_stream_start",
						requestBytes: new TextEncoder().encode(bodyJson).byteLength
					}));
					recordWebSocketFailure(options?.sessionId, error);
					if (websocketStarted) throw error;
					recordWebSocketSseFallback(options?.sessionId);
				}
			}
			let response;
			let lastError;
			const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				if (options?.signal?.aborted) throw new Error("Request was aborted");
				try {
					const headerTimeout = createSSEHeaderTimeout();
					const combinedSignal = combineAbortSignals([options?.signal, headerTimeout.signal]);
					try {
						response = await fetch(resolveCodexUrl(model.baseUrl), {
							method: "POST",
							headers: sseHeaders,
							body: bodyJson,
							signal: combinedSignal.signal
						});
					} catch (error) {
						const timeoutError = headerTimeout.error();
						throw timeoutError && !options?.signal?.aborted ? timeoutError : error;
					} finally {
						combinedSignal.cleanup();
						headerTimeout.clear();
					}
					await options?.onResponse?.({
						status: response.status,
						headers: headersToRecord(response.headers)
					}, model);
					if (response.ok) break;
					const errorText = await response.text();
					if (attempt < maxRetries && isRetryableError(response.status, errorText)) {
						const retryAfterDelayMs = getRetryAfterDelayMs(response.headers);
						await sleep(retryAfterDelayMs === void 0 ? BASE_DELAY_MS * 2 ** attempt : response.status === 429 ? capRetryDelayMs(retryAfterDelayMs, options) : retryAfterDelayMs, options?.signal);
						continue;
					}
					const info = await parseErrorResponse(new Response(errorText, {
						status: response.status,
						statusText: response.statusText
					}));
					throw new Error(info.friendlyMessage || info.message);
				} catch (error) {
					if (error instanceof Error) {
						if (error.name === "AbortError" || error.message === "Request was aborted") throw new Error("Request was aborted");
					}
					lastError = error instanceof Error ? error : new Error(String(error));
					if (attempt < maxRetries && !lastError.message.includes("usage limit")) {
						await sleep(BASE_DELAY_MS * 2 ** attempt, options?.signal);
						continue;
					}
					throw lastError;
				}
			}
			if (!response?.ok) throw lastError ?? /* @__PURE__ */ new Error("Failed after retries");
			if (!response.body) throw new Error("No response body");
			stream.push({
				type: "start",
				partial: output
			});
			await processStream(response, output, stream, model, options);
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			stream.push({
				type: "done",
				reason: output.stopReason,
				message: output
			});
			stream.end();
		} catch (error) {
			for (const block of output.content) delete block.partialJson;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({
				type: "error",
				reason: output.stopReason,
				error: output
			});
			stream.end();
		}
	})();
	return stream;
};
var streamSimpleOpenAICodexResponses = (model, context, options) => {
	const apiKey = options?.apiKey;
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const base = buildBaseOptions(model, options, apiKey);
	const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : void 0;
	const reasoningEffort = clampedReasoning === "off" ? void 0 : clampedReasoning;
	return streamOpenAICodexResponses(model, context, {
		...base,
		reasoningEffort
	});
};
function buildRequestBody(model, context, options) {
	const messages = convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, { includeSystemPrompt: false });
	const body = {
		model: model.id,
		store: false,
		stream: true,
		instructions: context.systemPrompt || "You are a helpful assistant.",
		input: messages,
		text: { verbosity: options?.textVerbosity || "low" },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: clampOpenAIPromptCacheKey(options?.sessionId),
		tool_choice: "auto",
		parallel_tool_calls: true
	};
	if (options?.temperature !== void 0) body.temperature = options.temperature;
	if (options?.serviceTier !== void 0) body.service_tier = options.serviceTier;
	if (context.tools && context.tools.length > 0) body.tools = convertResponsesTools(context.tools, { strict: null });
	if (options?.reasoningEffort !== void 0) {
		const effort = options.reasoningEffort === "none" ? model.thinkingLevelMap?.off ?? "none" : model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
		if (effort !== null) body.reasoning = {
			effort,
			summary: options.reasoningSummary ?? "auto"
		};
	}
	return body;
}
function getServiceTierCostMultiplier(model, serviceTier) {
	switch (serviceTier) {
		case "flex": return .5;
		case "priority": return model.id === "gpt-5.5" ? 2.5 : 2;
		default: return 1;
	}
}
function applyServiceTierPricing(usage, serviceTier, model) {
	const multiplier = getServiceTierCostMultiplier(model, serviceTier);
	if (multiplier === 1) return;
	usage.cost.input *= multiplier;
	usage.cost.output *= multiplier;
	usage.cost.cacheRead *= multiplier;
	usage.cost.cacheWrite *= multiplier;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
function resolveCodexServiceTier(responseServiceTier, requestServiceTier) {
	if (responseServiceTier === "default" && (requestServiceTier === "flex" || requestServiceTier === "priority")) return requestServiceTier;
	return responseServiceTier ?? requestServiceTier;
}
function resolveCodexUrl(baseUrl) {
	const normalized = (baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL).replace(/\/+$/, "");
	if (normalized.endsWith("/codex/responses")) return normalized;
	if (normalized.endsWith("/codex")) return `${normalized}/responses`;
	return `${normalized}/codex/responses`;
}
function resolveCodexWebSocketUrl(baseUrl) {
	const url = new URL(resolveCodexUrl(baseUrl));
	if (url.protocol === "https:") url.protocol = "wss:";
	if (url.protocol === "http:") url.protocol = "ws:";
	return url.toString();
}
async function processStream(response, output, stream, model, options) {
	await processResponsesStream(mapCodexEvents(parseSSE(response, options?.signal)), output, stream, model, {
		serviceTier: options?.serviceTier,
		resolveServiceTier: resolveCodexServiceTier,
		applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model)
	});
}
var CodexApiError = class extends Error {
	code;
	payload;
	constructor(message, options) {
		super(message);
		this.name = "CodexApiError";
		this.code = options?.code;
		this.payload = options?.payload;
		this.cause = options?.cause;
	}
};
var CodexProtocolError = class extends Error {
	payload;
	constructor(message, options) {
		super(message);
		this.name = "CodexProtocolError";
		this.payload = options?.payload;
		this.cause = options?.cause;
	}
};
function isCodexNonTransportError(error) {
	return error instanceof CodexApiError || error instanceof CodexProtocolError;
}
async function* mapCodexEvents(events) {
	for await (const event of events) {
		const type = typeof event.type === "string" ? event.type : void 0;
		if (!type) continue;
		if (type === "error") {
			const code = event.code || "";
			throw new CodexApiError(`Codex error: ${event.message || code || JSON.stringify(event)}`, {
				code: code || void 0,
				payload: event
			});
		}
		if (type === "response.failed") {
			const response = event.response;
			const code = response?.error?.code;
			const message = response?.error?.message;
			throw new CodexApiError(message || "Codex response failed", {
				code,
				payload: event
			});
		}
		if (type === "response.done" || type === "response.completed" || type === "response.incomplete") {
			const response = event.response;
			const normalizedResponse = response ? {
				...response,
				status: normalizeCodexStatus(response.status)
			} : response;
			yield {
				...event,
				type: "response.completed",
				response: normalizedResponse
			};
			return;
		}
		yield event;
	}
}
function normalizeCodexStatus(status) {
	if (typeof status !== "string") return void 0;
	return CODEX_RESPONSE_STATUSES.has(status) ? status : void 0;
}
async function* parseSSE(response, signal) {
	if (!response.body) return;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const onAbort = () => {
		reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		while (true) {
			if (signal?.aborted) throw new Error("Request was aborted");
			const { done, value } = await reader.read();
			if (signal?.aborted) throw new Error("Request was aborted");
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx = buffer.indexOf("\n\n");
			while (idx !== -1) {
				const chunk = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const dataLines = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
				if (dataLines.length > 0) {
					const data = dataLines.join("\n").trim();
					if (data && data !== "[DONE]") try {
						yield JSON.parse(data);
					} catch (cause) {
						throw new CodexProtocolError(`Invalid Codex SSE JSON: ${formatThrownValue(cause)}`, {
							cause,
							payload: data
						});
					}
				}
				idx = buffer.indexOf("\n\n");
			}
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
		try {
			await reader.cancel();
		} catch {}
		try {
			reader.releaseLock();
		} catch {}
	}
}
var OPENAI_BETA_RESPONSES_WEBSOCKETS = "responses_websockets=2026-02-06";
var SESSION_WEBSOCKET_CACHE_TTL_MS = 300 * 1e3;
var websocketSessionCache = /* @__PURE__ */ new Map();
var websocketDebugStats = /* @__PURE__ */ new Map();
var websocketSseFallbackSessions = /* @__PURE__ */ new Set();
function getOrCreateWebSocketDebugStats(sessionId) {
	let stats = websocketDebugStats.get(sessionId);
	if (!stats) {
		stats = {
			requests: 0,
			connectionsCreated: 0,
			connectionsReused: 0,
			cachedContextRequests: 0,
			storeTrueRequests: 0,
			fullContextRequests: 0,
			deltaRequests: 0,
			lastInputItems: 0,
			websocketFailures: 0,
			sseFallbacks: 0
		};
		websocketDebugStats.set(sessionId, stats);
	}
	return stats;
}
function getOpenAICodexWebSocketDebugStats(sessionId) {
	const stats = websocketDebugStats.get(sessionId);
	return stats ? { ...stats } : void 0;
}
function resetOpenAICodexWebSocketDebugStats(sessionId) {
	if (sessionId) {
		websocketDebugStats.delete(sessionId);
		websocketSseFallbackSessions.delete(sessionId);
		return;
	}
	websocketDebugStats.clear();
	websocketSseFallbackSessions.clear();
}
function closeOpenAICodexWebSocketSessions(sessionId) {
	const closeEntry = (entry) => {
		if (entry.idleTimer) clearTimeout(entry.idleTimer);
		closeWebSocketSilently(entry.socket, 1e3, "debug_close");
	};
	if (sessionId) {
		const entry = websocketSessionCache.get(sessionId);
		if (entry) closeEntry(entry);
		websocketSessionCache.delete(sessionId);
		return;
	}
	for (const entry of websocketSessionCache.values()) closeEntry(entry);
	websocketSessionCache.clear();
}
registerSessionResourceCleanup(closeOpenAICodexWebSocketSessions);
function isWebSocketSseFallbackActive(sessionId) {
	return sessionId ? websocketSseFallbackSessions.has(sessionId) : false;
}
function recordWebSocketSseFallback(sessionId) {
	if (!sessionId) return;
	const stats = getOrCreateWebSocketDebugStats(sessionId);
	stats.sseFallbacks++;
	stats.websocketFallbackActive = isWebSocketSseFallbackActive(sessionId);
}
function recordWebSocketFailure(sessionId, error) {
	if (!sessionId) return;
	websocketSseFallbackSessions.add(sessionId);
	const stats = getOrCreateWebSocketDebugStats(sessionId);
	stats.websocketFailures++;
	stats.lastWebSocketError = formatThrownValue(error);
	stats.websocketFallbackActive = true;
}
var _cachedWebsocket = null;
async function getWebSocketConstructor() {
	if (_cachedWebsocket) return _cachedWebsocket;
	if (process?.versions?.bun && (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)) {
		const getProxyForUrl = (await dynamicImport("proxy-from-env")).getProxyForUrl;
		_cachedWebsocket = class extends WebSocket {
			constructor(url, options) {
				let _opts = {};
				if (Array.isArray(options) || typeof options === "string") _opts = { protocols: options };
				else _opts = { ...options };
				const proxy = getProxyForUrl(url.toString().replace(/^wss:/, "https:").replace(/^ws:/, "http:"));
				super(url, {
					..._opts,
					...proxy ? { proxy } : {}
				});
			}
		};
		return _cachedWebsocket;
	}
	const ctor = globalThis.WebSocket;
	if (typeof ctor !== "function") return null;
	return ctor;
}
var WebSocketCloseError = class extends Error {
	code;
	reason;
	wasClean;
	constructor(message, options) {
		super(message);
		this.name = "WebSocketCloseError";
		this.code = options?.code;
		this.reason = options?.reason;
		this.wasClean = options?.wasClean;
	}
};
function getWebSocketReadyState(socket) {
	const readyState = socket.readyState;
	return typeof readyState === "number" ? readyState : void 0;
}
function isWebSocketReusable(socket) {
	const readyState = getWebSocketReadyState(socket);
	return readyState === void 0 || readyState === 1;
}
function closeWebSocketSilently(socket, code = 1e3, reason = "done") {
	try {
		socket.close(code, reason);
	} catch {}
}
function scheduleSessionWebSocketExpiry(sessionId, entry) {
	if (entry.idleTimer) clearTimeout(entry.idleTimer);
	entry.idleTimer = setTimeout(() => {
		if (entry.busy) return;
		closeWebSocketSilently(entry.socket, 1e3, "idle_timeout");
		websocketSessionCache.delete(sessionId);
	}, SESSION_WEBSOCKET_CACHE_TTL_MS);
}
async function connectWebSocket(url, headers, signal, connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS) {
	const WebSocketCtor = await getWebSocketConstructor();
	if (!WebSocketCtor) throw new Error("WebSocket transport is not available in this runtime");
	const wsHeaders = headersToRecord(headers);
	delete wsHeaders["OpenAI-Beta"];
	return new Promise((resolve, reject) => {
		let settled = false;
		let timeout;
		let socket;
		try {
			socket = new WebSocketCtor(url, { headers: wsHeaders });
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		const cleanup = () => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = void 0;
			}
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("error", onError);
			socket.removeEventListener("close", onClose);
			signal?.removeEventListener("abort", onAbort);
		};
		const fail = (error, closeReason) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (closeReason) closeWebSocketSilently(socket, 1e3, closeReason);
			reject(error);
		};
		const onOpen = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(socket);
		};
		const onError = (event) => {
			fail(extractWebSocketError(event));
		};
		const onClose = (event) => {
			fail(extractWebSocketCloseError(event));
		};
		const onAbort = () => {
			fail(/* @__PURE__ */ new Error("Request was aborted"), "aborted");
		};
		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
		socket.addEventListener("close", onClose);
		signal?.addEventListener("abort", onAbort);
		if (connectTimeoutMs > 0) timeout = setTimeout(() => {
			fail(/* @__PURE__ */ new Error(`WebSocket connect timeout after ${connectTimeoutMs}ms`), "connect_timeout");
		}, connectTimeoutMs);
		if (signal?.aborted) onAbort();
	});
}
async function acquireWebSocket(url, headers, sessionId, signal, connectTimeoutMs) {
	if (!sessionId) {
		const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs);
		return {
			socket,
			reused: false,
			release: () => closeWebSocketSilently(socket)
		};
	}
	const cached = websocketSessionCache.get(sessionId);
	if (cached) {
		if (cached.idleTimer) {
			clearTimeout(cached.idleTimer);
			cached.idleTimer = void 0;
		}
		if (!cached.busy && isWebSocketReusable(cached.socket)) {
			cached.busy = true;
			return {
				socket: cached.socket,
				entry: cached,
				reused: true,
				release: ({ keep } = {}) => {
					if (!keep || !isWebSocketReusable(cached.socket)) {
						closeWebSocketSilently(cached.socket);
						websocketSessionCache.delete(sessionId);
						return;
					}
					cached.busy = false;
					scheduleSessionWebSocketExpiry(sessionId, cached);
				}
			};
		}
		if (cached.busy) {
			const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs);
			return {
				socket,
				reused: false,
				release: () => {
					closeWebSocketSilently(socket);
				}
			};
		}
		if (!isWebSocketReusable(cached.socket)) {
			closeWebSocketSilently(cached.socket);
			websocketSessionCache.delete(sessionId);
		}
	}
	const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs);
	const entry = {
		socket,
		busy: true
	};
	websocketSessionCache.set(sessionId, entry);
	return {
		socket,
		entry,
		reused: false,
		release: ({ keep } = {}) => {
			if (!keep || !isWebSocketReusable(entry.socket)) {
				closeWebSocketSilently(entry.socket);
				if (entry.idleTimer) clearTimeout(entry.idleTimer);
				if (websocketSessionCache.get(sessionId) === entry) websocketSessionCache.delete(sessionId);
				return;
			}
			entry.busy = false;
			scheduleSessionWebSocketExpiry(sessionId, entry);
		}
	};
}
function extractWebSocketError(event) {
	if (event && typeof event === "object") {
		const message = "message" in event ? event.message : void 0;
		if (typeof message === "string" && message.length > 0) return new Error(message);
		const nestedError = "error" in event ? event.error : void 0;
		if (nestedError instanceof Error && nestedError.message.length > 0) return nestedError;
		if (nestedError && typeof nestedError === "object" && "message" in nestedError) {
			const nestedMessage = nestedError.message;
			if (typeof nestedMessage === "string" && nestedMessage.length > 0) return new Error(nestedMessage);
		}
	}
	return /* @__PURE__ */ new Error("WebSocket error");
}
function extractWebSocketCloseError(event) {
	if (event && typeof event === "object") {
		const code = "code" in event ? event.code : void 0;
		const reason = "reason" in event ? event.reason : void 0;
		const wasClean = "wasClean" in event ? event.wasClean : void 0;
		const codeText = typeof code === "number" ? ` ${code}` : "";
		let reasonText = typeof reason === "string" && reason.length > 0 ? ` ${reason}` : "";
		if (!reasonText && code === WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE) reasonText = " message too big";
		return new WebSocketCloseError(`WebSocket closed${codeText}${reasonText}`.trim(), {
			code: typeof code === "number" ? code : void 0,
			reason: typeof reason === "string" && reason.length > 0 ? reason : void 0,
			wasClean: typeof wasClean === "boolean" ? wasClean : void 0
		});
	}
	return /* @__PURE__ */ new Error("WebSocket closed");
}
async function decodeWebSocketData(data) {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
	if (ArrayBuffer.isView(data)) {
		const view = data;
		return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
	}
	if (data && typeof data === "object" && "arrayBuffer" in data) {
		const arrayBuffer = await data.arrayBuffer();
		return new TextDecoder().decode(new Uint8Array(arrayBuffer));
	}
	return null;
}
async function* parseWebSocket(socket, signal, idleTimeoutMs) {
	const queue = [];
	let pending = null;
	let done = false;
	let failed = null;
	let sawCompletion = false;
	const wake = () => {
		if (!pending) return;
		const resolve = pending;
		pending = null;
		resolve();
	};
	const onMessage = (event) => {
		(async () => {
			let text = null;
			try {
				if (!event || typeof event !== "object" || !("data" in event)) return;
				text = await decodeWebSocketData(event.data);
				if (!text) return;
				const parsed = JSON.parse(text);
				const type = typeof parsed.type === "string" ? parsed.type : "";
				if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
					sawCompletion = true;
					done = true;
				}
				queue.push(parsed);
				wake();
			} catch (cause) {
				failed = new CodexProtocolError(`Invalid Codex WebSocket JSON: ${formatThrownValue(cause)}`, {
					cause,
					payload: text
				});
				done = true;
				wake();
			}
		})();
	};
	const onError = (event) => {
		failed = extractWebSocketError(event);
		done = true;
		wake();
	};
	const onClose = (event) => {
		if (sawCompletion) {
			done = true;
			wake();
			return;
		}
		if (!failed) failed = extractWebSocketCloseError(event);
		done = true;
		wake();
	};
	const onAbort = () => {
		failed = /* @__PURE__ */ new Error("Request was aborted");
		done = true;
		wake();
	};
	socket.addEventListener("message", onMessage);
	socket.addEventListener("error", onError);
	socket.addEventListener("close", onClose);
	signal?.addEventListener("abort", onAbort);
	try {
		while (true) {
			if (signal?.aborted) throw new Error("Request was aborted");
			if (queue.length > 0) {
				yield queue.shift();
				continue;
			}
			if (done) break;
			let timeout;
			await new Promise((resolve, reject) => {
				pending = resolve;
				if (idleTimeoutMs !== void 0 && idleTimeoutMs > 0) timeout = setTimeout(() => {
					const error = /* @__PURE__ */ new Error(`WebSocket idle timeout after ${idleTimeoutMs}ms`);
					failed = error;
					done = true;
					pending = null;
					closeWebSocketSilently(socket, 1e3, "idle_timeout");
					reject(error);
				}, idleTimeoutMs);
			}).finally(() => {
				if (timeout) clearTimeout(timeout);
			});
		}
		if (failed) throw failed;
		if (!sawCompletion) throw new Error("WebSocket stream closed before response.completed");
	} finally {
		socket.removeEventListener("message", onMessage);
		socket.removeEventListener("error", onError);
		socket.removeEventListener("close", onClose);
		signal?.removeEventListener("abort", onAbort);
	}
}
function requestBodyWithoutInput(body) {
	const { input: _input, previous_response_id: _previousResponseId, ...rest } = body;
	return rest;
}
function responseInputsEqual(a, b) {
	return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}
function requestBodiesMatchExceptInput(a, b) {
	return JSON.stringify(requestBodyWithoutInput(a)) === JSON.stringify(requestBodyWithoutInput(b));
}
function getCachedWebSocketInputDelta(body, continuation) {
	if (!requestBodiesMatchExceptInput(body, continuation.lastRequestBody)) return;
	const currentInput = body.input ?? [];
	const baseline = [...continuation.lastRequestBody.input ?? [], ...continuation.lastResponseItems];
	if (currentInput.length < baseline.length) return;
	if (!responseInputsEqual(currentInput.slice(0, baseline.length), baseline)) return;
	return currentInput.slice(baseline.length);
}
function buildCachedWebSocketRequestBody(entry, body) {
	const continuation = entry.continuation;
	if (!continuation) return body;
	const delta = getCachedWebSocketInputDelta(body, continuation);
	if (!delta || !continuation.lastResponseId) {
		entry.continuation = void 0;
		return body;
	}
	return {
		...body,
		previous_response_id: continuation.lastResponseId,
		input: delta
	};
}
async function* startWebSocketOutputOnFirstEvent(events, output, stream, onStart) {
	let started = false;
	for await (const event of events) {
		if (!started) {
			started = true;
			onStart();
			stream.push({
				type: "start",
				partial: output
			});
		}
		yield event;
	}
}
async function processWebSocketStream(url, body, headers, output, stream, model, onStart, idleTimeoutMs, websocketConnectTimeoutMs, options) {
	const { socket, entry, reused, release } = await acquireWebSocket(url, headers, options?.sessionId, options?.signal, websocketConnectTimeoutMs);
	let keepConnection = true;
	const useCachedContext = options?.transport === "websocket-cached" || options?.transport === "auto";
	const fullBody = body;
	const requestBody = useCachedContext && entry ? buildCachedWebSocketRequestBody(entry, fullBody) : fullBody;
	const stats = options?.sessionId ? getOrCreateWebSocketDebugStats(options.sessionId) : void 0;
	if (stats) {
		stats.requests++;
		if (reused) stats.connectionsReused++;
		else stats.connectionsCreated++;
		if (useCachedContext) stats.cachedContextRequests++;
		if (requestBody.store === true) stats.storeTrueRequests++;
		stats.lastInputItems = requestBody.input?.length ?? 0;
		if (requestBody.previous_response_id) {
			stats.deltaRequests++;
			stats.lastDeltaInputItems = requestBody.input?.length ?? 0;
			stats.lastPreviousResponseId = requestBody.previous_response_id;
		} else {
			stats.fullContextRequests++;
			stats.lastDeltaInputItems = void 0;
			stats.lastPreviousResponseId = void 0;
		}
	}
	try {
		socket.send(JSON.stringify({
			type: "response.create",
			...requestBody
		}));
		await processResponsesStream(startWebSocketOutputOnFirstEvent(mapCodexEvents(parseWebSocket(socket, options?.signal, idleTimeoutMs)), output, stream, onStart), output, stream, model, {
			serviceTier: options?.serviceTier,
			resolveServiceTier: resolveCodexServiceTier,
			applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model)
		});
		if (options?.signal?.aborted) keepConnection = false;
		else if (useCachedContext && entry && output.responseId) {
			const responseItems = convertResponsesMessages(model, { messages: [output] }, CODEX_TOOL_CALL_PROVIDERS, { includeSystemPrompt: false }).filter((item) => item.type !== "function_call_output");
			entry.continuation = {
				lastRequestBody: fullBody,
				lastResponseId: output.responseId,
				lastResponseItems: responseItems
			};
		}
	} catch (error) {
		if (entry) entry.continuation = void 0;
		keepConnection = false;
		throw error;
	} finally {
		release({ keep: keepConnection });
	}
}
async function parseErrorResponse(response) {
	const raw = await response.text();
	let message = raw || response.statusText || "Request failed";
	let friendlyMessage;
	try {
		const err = JSON.parse(raw)?.error;
		if (err) {
			const code = err.code || err.type || "";
			if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
				const plan = err.plan_type ? ` (${err.plan_type.toLowerCase()} plan)` : "";
				const mins = err.resets_at ? Math.max(0, Math.round((err.resets_at * 1e3 - Date.now()) / 6e4)) : void 0;
				friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${mins !== void 0 ? ` Try again in ~${mins} min.` : ""}`.trim();
			}
			message = err.message || friendlyMessage || message;
		}
	} catch {}
	return {
		message,
		friendlyMessage
	};
}
function extractAccountId(token) {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("Invalid token");
		const accountId = JSON.parse(atob(parts[1]))?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
		if (!accountId) throw new Error("No account ID in token");
		return accountId;
	} catch {
		throw new Error("Failed to extract accountId from token");
	}
}
function createCodexRequestId() {
	if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
	return `codex_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
function buildBaseCodexHeaders(initHeaders, additionalHeaders, accountId, token) {
	const headers = new Headers(initHeaders);
	for (const [key, value] of Object.entries(additionalHeaders || {})) headers.set(key, value);
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("originator", "pi");
	const userAgent = _os ? `pi (${_os.platform()} ${_os.release()}; ${_os.arch()})` : "pi (browser)";
	headers.set("User-Agent", userAgent);
	return headers;
}
function buildSSEHeaders(initHeaders, additionalHeaders, accountId, token, sessionId) {
	const headers = buildBaseCodexHeaders(initHeaders, additionalHeaders, accountId, token);
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");
	if (sessionId) {
		headers.set("session-id", sessionId);
		headers.set("x-client-request-id", sessionId);
	}
	return headers;
}
function buildWebSocketHeaders(initHeaders, additionalHeaders, accountId, token, requestId) {
	const headers = buildBaseCodexHeaders(initHeaders, additionalHeaders, accountId, token);
	headers.delete("accept");
	headers.delete("content-type");
	headers.delete("OpenAI-Beta");
	headers.delete("openai-beta");
	headers.set("OpenAI-Beta", OPENAI_BETA_RESPONSES_WEBSOCKETS);
	headers.set("x-client-request-id", requestId);
	headers.set("session-id", requestId);
	return headers;
}
//#endregion
export { closeOpenAICodexWebSocketSessions, getOpenAICodexWebSocketDebugStats, resetOpenAICodexWebSocketDebugStats, streamOpenAICodexResponses, streamSimpleOpenAICodexResponses };
