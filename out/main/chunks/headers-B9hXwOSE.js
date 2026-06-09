//#region node_modules/@earendil-works/pi-ai/dist/utils/headers.js
function headersToRecord(headers) {
	const result = {};
	for (const [key, value] of headers.entries()) result[key] = value;
	return result;
}
//#endregion
export { headersToRecord as t };
