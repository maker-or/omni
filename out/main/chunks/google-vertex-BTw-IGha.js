import { c as calculateCost, l as clampThinkingLevel, s as AssistantMessageEventStream } from "../index.js";
import { t as sanitizeSurrogates } from "./sanitize-unicode-Ds14l9Om.js";
import { r as buildBaseOptions } from "./transform-messages-Db9U73l0.js";
import { a as mapToolChoice, c as ResourceScope, i as mapStopReason, l as ThinkingLevel, n as convertTools, o as retainThoughtSignature, r as isThinkingPart, s as GoogleGenAI, t as convertMessages } from "./google-shared-IBBCwQ9e.js";
//#region node_modules/@earendil-works/pi-ai/dist/providers/google-vertex.js
var API_VERSION = "v1";
var GCP_VERTEX_CREDENTIALS_MARKER = "gcp-vertex-credentials";
var THINKING_LEVEL_MAP = {
	THINKING_LEVEL_UNSPECIFIED: ThinkingLevel.THINKING_LEVEL_UNSPECIFIED,
	MINIMAL: ThinkingLevel.MINIMAL,
	LOW: ThinkingLevel.LOW,
	MEDIUM: ThinkingLevel.MEDIUM,
	HIGH: ThinkingLevel.HIGH
};
var toolCallCounter = 0;
var streamGoogleVertex = (model, context, options) => {
	const stream = new AssistantMessageEventStream();
	(async () => {
		const output = {
			role: "assistant",
			content: [],
			api: "google-vertex",
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
			const apiKey = resolveApiKey(options);
			const client = apiKey ? createClientWithApiKey(model, apiKey, options?.headers) : createClient(model, resolveProject(options), resolveLocation(options), options?.headers);
			let params = buildParams(model, context, options);
			const nextParams = await options?.onPayload?.(params, model);
			if (nextParams !== void 0) params = nextParams;
			const googleStream = await client.models.generateContentStream(params);
			stream.push({
				type: "start",
				partial: output
			});
			let currentBlock = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			for await (const chunk of googleStream) {
				output.responseId ||= chunk.responseId;
				const candidate = chunk.candidates?.[0];
				if (candidate?.content?.parts) for (const part of candidate.content.parts) {
					if (part.text !== void 0) {
						const isThinking = isThinkingPart(part);
						if (!currentBlock || isThinking && currentBlock.type !== "thinking" || !isThinking && currentBlock.type !== "text") {
							if (currentBlock) if (currentBlock.type === "text") stream.push({
								type: "text_end",
								contentIndex: blocks.length - 1,
								content: currentBlock.text,
								partial: output
							});
							else stream.push({
								type: "thinking_end",
								contentIndex: blockIndex(),
								content: currentBlock.thinking,
								partial: output
							});
							if (isThinking) {
								currentBlock = {
									type: "thinking",
									thinking: "",
									thinkingSignature: void 0
								};
								output.content.push(currentBlock);
								stream.push({
									type: "thinking_start",
									contentIndex: blockIndex(),
									partial: output
								});
							} else {
								currentBlock = {
									type: "text",
									text: ""
								};
								output.content.push(currentBlock);
								stream.push({
									type: "text_start",
									contentIndex: blockIndex(),
									partial: output
								});
							}
						}
						if (currentBlock.type === "thinking") {
							currentBlock.thinking += part.text;
							currentBlock.thinkingSignature = retainThoughtSignature(currentBlock.thinkingSignature, part.thoughtSignature);
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: part.text,
								partial: output
							});
						} else {
							currentBlock.text += part.text;
							currentBlock.textSignature = retainThoughtSignature(currentBlock.textSignature, part.thoughtSignature);
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: part.text,
								partial: output
							});
						}
					}
					if (part.functionCall) {
						if (currentBlock) {
							if (currentBlock.type === "text") stream.push({
								type: "text_end",
								contentIndex: blockIndex(),
								content: currentBlock.text,
								partial: output
							});
							else stream.push({
								type: "thinking_end",
								contentIndex: blockIndex(),
								content: currentBlock.thinking,
								partial: output
							});
							currentBlock = null;
						}
						const providedId = part.functionCall.id;
						const toolCall = {
							type: "toolCall",
							id: !providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId) ? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}` : providedId,
							name: part.functionCall.name || "",
							arguments: part.functionCall.args ?? {},
							...part.thoughtSignature && { thoughtSignature: part.thoughtSignature }
						};
						output.content.push(toolCall);
						stream.push({
							type: "toolcall_start",
							contentIndex: blockIndex(),
							partial: output
						});
						stream.push({
							type: "toolcall_delta",
							contentIndex: blockIndex(),
							delta: JSON.stringify(toolCall.arguments),
							partial: output
						});
						stream.push({
							type: "toolcall_end",
							contentIndex: blockIndex(),
							toolCall,
							partial: output
						});
					}
				}
				if (candidate?.finishReason) {
					output.stopReason = mapStopReason(candidate.finishReason);
					if (output.content.some((b) => b.type === "toolCall")) output.stopReason = "toolUse";
				}
				if (chunk.usageMetadata) {
					output.usage = {
						input: (chunk.usageMetadata.promptTokenCount || 0) - (chunk.usageMetadata.cachedContentTokenCount || 0),
						output: (chunk.usageMetadata.candidatesTokenCount || 0) + (chunk.usageMetadata.thoughtsTokenCount || 0),
						cacheRead: chunk.usageMetadata.cachedContentTokenCount || 0,
						cacheWrite: 0,
						totalTokens: chunk.usageMetadata.totalTokenCount || 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0
						}
					};
					calculateCost(model, output.usage);
				}
			}
			if (currentBlock) if (currentBlock.type === "text") stream.push({
				type: "text_end",
				contentIndex: blockIndex(),
				content: currentBlock.text,
				partial: output
			});
			else stream.push({
				type: "thinking_end",
				contentIndex: blockIndex(),
				content: currentBlock.thinking,
				partial: output
			});
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			if (output.stopReason === "aborted" || output.stopReason === "error") throw new Error("An unknown error occurred");
			stream.push({
				type: "done",
				reason: output.stopReason,
				message: output
			});
			stream.end();
		} catch (error) {
			for (const block of output.content) if ("index" in block) delete block.index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
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
var streamSimpleGoogleVertex = (model, context, options) => {
	const base = buildBaseOptions(model, options, void 0);
	if (!options?.reasoning) return streamGoogleVertex(model, context, {
		...base,
		thinking: { enabled: false }
	});
	const clampedReasoning = clampThinkingLevel(model, options.reasoning);
	const effort = clampedReasoning === "off" ? "high" : clampedReasoning;
	const geminiModel = model;
	if (isGemini3ProModel(geminiModel) || isGemini3FlashModel(geminiModel)) return streamGoogleVertex(model, context, {
		...base,
		thinking: {
			enabled: true,
			level: getGemini3ThinkingLevel(effort, geminiModel)
		}
	});
	return streamGoogleVertex(model, context, {
		...base,
		thinking: {
			enabled: true,
			budgetTokens: getGoogleBudget(geminiModel, effort, options.thinkingBudgets)
		}
	});
};
function createClient(model, project, location, optionsHeaders) {
	return new GoogleGenAI({
		vertexai: true,
		project,
		location,
		apiVersion: API_VERSION,
		httpOptions: buildHttpOptions(model, optionsHeaders)
	});
}
function createClientWithApiKey(model, apiKey, optionsHeaders) {
	return new GoogleGenAI({
		vertexai: true,
		apiKey,
		apiVersion: API_VERSION,
		httpOptions: buildHttpOptions(model, optionsHeaders)
	});
}
function buildHttpOptions(model, optionsHeaders) {
	const httpOptions = {};
	const baseUrl = resolveCustomBaseUrl(model.baseUrl);
	if (baseUrl) {
		httpOptions.baseUrl = baseUrl;
		httpOptions.baseUrlResourceScope = ResourceScope.COLLECTION;
		if (baseUrlIncludesApiVersion(baseUrl)) httpOptions.apiVersion = "";
	}
	if (model.headers || optionsHeaders) httpOptions.headers = {
		...model.headers,
		...optionsHeaders
	};
	return Object.keys(httpOptions).length > 0 ? httpOptions : void 0;
}
function resolveCustomBaseUrl(baseUrl) {
	const trimmed = baseUrl.trim();
	if (!trimmed || trimmed.includes("{location}")) return;
	return trimmed;
}
function baseUrlIncludesApiVersion(baseUrl) {
	try {
		return new URL(baseUrl).pathname.split("/").some((part) => /^v\d+(?:beta\d*)?$/.test(part));
	} catch {
		return /(?:^|\/)v\d+(?:beta\d*)?(?:\/|$)/.test(baseUrl);
	}
}
function resolveApiKey(options) {
	const apiKey = options?.apiKey?.trim();
	if (!apiKey || apiKey === GCP_VERTEX_CREDENTIALS_MARKER || isPlaceholderApiKey(apiKey)) return;
	return apiKey;
}
function isPlaceholderApiKey(apiKey) {
	return /^<[^>]+>$/.test(apiKey);
}
function resolveProject(options) {
	const project = options?.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
	if (!project) throw new Error("Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT or pass project in options.");
	return project;
}
function resolveLocation(options) {
	const location = options?.location || process.env.GOOGLE_CLOUD_LOCATION;
	if (!location) throw new Error("Vertex AI requires a location. Set GOOGLE_CLOUD_LOCATION or pass location in options.");
	return location;
}
function buildParams(model, context, options = {}) {
	const contents = convertMessages(model, context);
	const generationConfig = {};
	if (options.temperature !== void 0) generationConfig.temperature = options.temperature;
	if (options.maxTokens !== void 0) generationConfig.maxOutputTokens = options.maxTokens;
	const config = {
		...Object.keys(generationConfig).length > 0 && generationConfig,
		...context.systemPrompt && { systemInstruction: sanitizeSurrogates(context.systemPrompt) },
		...context.tools && context.tools.length > 0 && { tools: convertTools(context.tools) }
	};
	if (context.tools && context.tools.length > 0 && options.toolChoice) config.toolConfig = { functionCallingConfig: { mode: mapToolChoice(options.toolChoice) } };
	else config.toolConfig = void 0;
	if (options.thinking?.enabled && model.reasoning) {
		const thinkingConfig = { includeThoughts: true };
		if (options.thinking.level !== void 0) thinkingConfig.thinkingLevel = THINKING_LEVEL_MAP[options.thinking.level];
		else if (options.thinking.budgetTokens !== void 0) thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
		config.thinkingConfig = thinkingConfig;
	} else if (model.reasoning && options.thinking && !options.thinking.enabled) config.thinkingConfig = getDisabledThinkingConfig(model);
	if (options.signal) {
		if (options.signal.aborted) throw new Error("Request aborted");
		config.abortSignal = options.signal;
	}
	return {
		model: model.id,
		contents,
		config
	};
}
function isGemini3ProModel(model) {
	return /gemini-3(?:\.\d+)?-pro/.test(model.id.toLowerCase());
}
function isGemini3FlashModel(model) {
	return /gemini-3(?:\.\d+)?-flash/.test(model.id.toLowerCase());
}
function getDisabledThinkingConfig(model) {
	const geminiModel = model;
	if (isGemini3ProModel(geminiModel)) return { thinkingLevel: ThinkingLevel.LOW };
	if (isGemini3FlashModel(geminiModel)) return { thinkingLevel: ThinkingLevel.MINIMAL };
	return { thinkingBudget: 0 };
}
function getGemini3ThinkingLevel(effort, model) {
	if (isGemini3ProModel(model)) switch (effort) {
		case "minimal":
		case "low": return "LOW";
		case "medium":
		case "high": return "HIGH";
	}
	switch (effort) {
		case "minimal": return "MINIMAL";
		case "low": return "LOW";
		case "medium": return "MEDIUM";
		case "high": return "HIGH";
	}
}
function getGoogleBudget(model, effort, customBudgets) {
	if (customBudgets?.[effort] !== void 0) return customBudgets[effort];
	if (model.id.includes("2.5-pro")) return {
		minimal: 128,
		low: 2048,
		medium: 8192,
		high: 32768
	}[effort];
	if (model.id.includes("2.5-flash")) return {
		minimal: 128,
		low: 2048,
		medium: 8192,
		high: 24576
	}[effort];
	return -1;
}
//#endregion
export { streamGoogleVertex, streamSimpleGoogleVertex };
