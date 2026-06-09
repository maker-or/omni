function clampOpenAIPromptCacheKey(key) {
	if (key === void 0) return void 0;
	const chars = Array.from(key);
	if (chars.length <= 64) return key;
	return chars.slice(0, 64).join("");
}
//#endregion
export { clampOpenAIPromptCacheKey as t };
