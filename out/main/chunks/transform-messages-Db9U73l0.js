//#region node_modules/@earendil-works/pi-ai/dist/providers/simple-options.js
function buildBaseOptions(_model, options, apiKey) {
	return {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens,
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
		transport: options?.transport,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		onResponse: options?.onResponse,
		timeoutMs: options?.timeoutMs,
		websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs,
		maxRetries: options?.maxRetries,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata
	};
}
function clampReasoning(effort) {
	return effort === "xhigh" ? "high" : effort;
}
function adjustMaxTokensForThinking(baseMaxTokens, modelMaxTokens, reasoningLevel, customBudgets) {
	const budgets = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
		...customBudgets
	};
	const minOutputTokens = 1024;
	let thinkingBudget = budgets[clampReasoning(reasoningLevel)];
	const maxTokens = baseMaxTokens === void 0 ? modelMaxTokens : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);
	if (maxTokens <= thinkingBudget) thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
	return {
		maxTokens,
		thinkingBudget
	};
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/providers/transform-messages.js
var NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
var NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";
function replaceImagesWithPlaceholder(content, placeholder) {
	const result = [];
	let previousWasPlaceholder = false;
	for (const block of content) {
		if (block.type === "image") {
			if (!previousWasPlaceholder) result.push({
				type: "text",
				text: placeholder
			});
			previousWasPlaceholder = true;
			continue;
		}
		result.push(block);
		previousWasPlaceholder = block.text === placeholder;
	}
	return result;
}
function downgradeUnsupportedImages(messages, model) {
	if (model.input.includes("image")) return messages;
	return messages.map((msg) => {
		if (msg.role === "user" && Array.isArray(msg.content)) return {
			...msg,
			content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER)
		};
		if (msg.role === "toolResult") return {
			...msg,
			content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER)
		};
		return msg;
	});
}
/**
* Normalize tool call ID for cross-provider compatibility.
* OpenAI Responses API generates IDs that are 450+ chars with special characters like `|`.
* Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars).
*/
function transformMessages(messages, model, normalizeToolCallId) {
	const toolCallIdMap = /* @__PURE__ */ new Map();
	const transformed = downgradeUnsupportedImages(messages, model).map((msg) => {
		if (msg.role === "user") return msg;
		if (msg.role === "toolResult") {
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			if (normalizedId && normalizedId !== msg.toolCallId) return {
				...msg,
				toolCallId: normalizedId
			};
			return msg;
		}
		if (msg.role === "assistant") {
			const assistantMsg = msg;
			const isSameModel = assistantMsg.provider === model.provider && assistantMsg.api === model.api && assistantMsg.model === model.id;
			const transformedContent = assistantMsg.content.flatMap((block) => {
				if (block.type === "thinking") {
					if (block.redacted) return isSameModel ? block : [];
					if (isSameModel && block.thinkingSignature) return block;
					if (!block.thinking || block.thinking.trim() === "") return [];
					if (isSameModel) return block;
					return {
						type: "text",
						text: block.thinking
					};
				}
				if (block.type === "text") {
					if (isSameModel) return block;
					return {
						type: "text",
						text: block.text
					};
				}
				if (block.type === "toolCall") {
					const toolCall = block;
					let normalizedToolCall = toolCall;
					if (!isSameModel && toolCall.thoughtSignature) {
						normalizedToolCall = { ...toolCall };
						delete normalizedToolCall.thoughtSignature;
					}
					if (!isSameModel && normalizeToolCallId) {
						const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
						if (normalizedId !== toolCall.id) {
							toolCallIdMap.set(toolCall.id, normalizedId);
							normalizedToolCall = {
								...normalizedToolCall,
								id: normalizedId
							};
						}
					}
					return normalizedToolCall;
				}
				return block;
			});
			return {
				...assistantMsg,
				content: transformedContent
			};
		}
		return msg;
	});
	const result = [];
	let pendingToolCalls = [];
	let existingToolResultIds = /* @__PURE__ */ new Set();
	const insertSyntheticToolResults = () => {
		if (pendingToolCalls.length > 0) {
			for (const tc of pendingToolCalls) if (!existingToolResultIds.has(tc.id)) result.push({
				role: "toolResult",
				toolCallId: tc.id,
				toolName: tc.name,
				content: [{
					type: "text",
					text: "No result provided"
				}],
				isError: true,
				timestamp: Date.now()
			});
			pendingToolCalls = [];
			existingToolResultIds = /* @__PURE__ */ new Set();
		}
	};
	for (let i = 0; i < transformed.length; i++) {
		const msg = transformed[i];
		if (msg.role === "assistant") {
			insertSyntheticToolResults();
			const assistantMsg = msg;
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") continue;
			const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				existingToolResultIds = /* @__PURE__ */ new Set();
			}
			result.push(msg);
		} else if (msg.role === "toolResult") {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else if (msg.role === "user") {
			insertSyntheticToolResults();
			result.push(msg);
		} else result.push(msg);
	}
	insertSyntheticToolResults();
	return result;
}
//#endregion
export { adjustMaxTokensForThinking as n, buildBaseOptions as r, transformMessages as t };
