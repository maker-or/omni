//#region node_modules/@earendil-works/pi-ai/dist/providers/cloudflare.js
function isCloudflareProvider(provider) {
	return provider === "cloudflare-workers-ai" || provider === "cloudflare-ai-gateway";
}
/** Substitute `{VAR}` placeholders in a Cloudflare baseUrl from process.env. */
function resolveCloudflareBaseUrl(model) {
	const url = model.baseUrl;
	if (!url.includes("{")) return url;
	return url.replace(/\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name) => {
		const value = process.env[name];
		if (!value) throw new Error(`${name} is required for provider ${model.provider} but is not set.`);
		return value;
	});
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/providers/github-copilot-headers.js
function inferCopilotInitiator(messages) {
	const last = messages[messages.length - 1];
	return last && last.role !== "user" ? "agent" : "user";
}
function hasCopilotVisionInput(messages) {
	return messages.some((msg) => {
		if (msg.role === "user" && Array.isArray(msg.content)) return msg.content.some((c) => c.type === "image");
		if (msg.role === "toolResult" && Array.isArray(msg.content)) return msg.content.some((c) => c.type === "image");
		return false;
	});
}
function buildCopilotDynamicHeaders(params) {
	const headers = {
		"X-Initiator": inferCopilotInitiator(params.messages),
		"Openai-Intent": "conversation-edits"
	};
	if (params.hasImages) headers["Copilot-Vision-Request"] = "true";
	return headers;
}
//#endregion
export { resolveCloudflareBaseUrl as i, hasCopilotVisionInput as n, isCloudflareProvider as r, buildCopilotDynamicHeaders as t };
