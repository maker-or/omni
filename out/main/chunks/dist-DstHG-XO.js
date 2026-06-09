import { p as __require, u as __commonJSMin } from "../index.js";
// -- CommonJS Shims --
import __cjs_mod__ from "node:module";
import.meta.filename;
import.meta.dirname;
__cjs_mod__.createRequire(import.meta.url);
//#region node_modules/ms/index.js
var require_ms = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Helpers.
	*/
	var s = 1e3;
	var m = s * 60;
	var h = m * 60;
	var d = h * 24;
	var w = d * 7;
	var y = d * 365.25;
	/**
	* Parse or format the given `val`.
	*
	* Options:
	*
	*  - `long` verbose formatting [false]
	*
	* @param {String|Number} val
	* @param {Object} [options]
	* @throws {Error} throw an error if val is not a non-empty string or a number
	* @return {String|Number}
	* @api public
	*/
	module.exports = function(val, options) {
		options = options || {};
		var type = typeof val;
		if (type === "string" && val.length > 0) return parse(val);
		else if (type === "number" && isFinite(val)) return options.long ? fmtLong(val) : fmtShort(val);
		throw new Error("val is not a non-empty string or a valid number. val=" + JSON.stringify(val));
	};
	/**
	* Parse the given `str` and return milliseconds.
	*
	* @param {String} str
	* @return {Number}
	* @api private
	*/
	function parse(str) {
		str = String(str);
		if (str.length > 100) return;
		var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str);
		if (!match) return;
		var n = parseFloat(match[1]);
		switch ((match[2] || "ms").toLowerCase()) {
			case "years":
			case "year":
			case "yrs":
			case "yr":
			case "y": return n * y;
			case "weeks":
			case "week":
			case "w": return n * w;
			case "days":
			case "day":
			case "d": return n * d;
			case "hours":
			case "hour":
			case "hrs":
			case "hr":
			case "h": return n * h;
			case "minutes":
			case "minute":
			case "mins":
			case "min":
			case "m": return n * m;
			case "seconds":
			case "second":
			case "secs":
			case "sec":
			case "s": return n * s;
			case "milliseconds":
			case "millisecond":
			case "msecs":
			case "msec":
			case "ms": return n;
			default: return;
		}
	}
	/**
	* Short format for `ms`.
	*
	* @param {Number} ms
	* @return {String}
	* @api private
	*/
	function fmtShort(ms) {
		var msAbs = Math.abs(ms);
		if (msAbs >= d) return Math.round(ms / d) + "d";
		if (msAbs >= h) return Math.round(ms / h) + "h";
		if (msAbs >= m) return Math.round(ms / m) + "m";
		if (msAbs >= s) return Math.round(ms / s) + "s";
		return ms + "ms";
	}
	/**
	* Long format for `ms`.
	*
	* @param {Number} ms
	* @return {String}
	* @api private
	*/
	function fmtLong(ms) {
		var msAbs = Math.abs(ms);
		if (msAbs >= d) return plural(ms, msAbs, d, "day");
		if (msAbs >= h) return plural(ms, msAbs, h, "hour");
		if (msAbs >= m) return plural(ms, msAbs, m, "minute");
		if (msAbs >= s) return plural(ms, msAbs, s, "second");
		return ms + " ms";
	}
	/**
	* Pluralization helper.
	*/
	function plural(ms, msAbs, n, name) {
		var isPlural = msAbs >= n * 1.5;
		return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
	}
}));
//#endregion
//#region node_modules/debug/src/common.js
var require_common = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* This is the common logic for both the Node.js and web browser
	* implementations of `debug()`.
	*/
	function setup(env) {
		createDebug.debug = createDebug;
		createDebug.default = createDebug;
		createDebug.coerce = coerce;
		createDebug.disable = disable;
		createDebug.enable = enable;
		createDebug.enabled = enabled;
		createDebug.humanize = require_ms();
		createDebug.destroy = destroy;
		Object.keys(env).forEach((key) => {
			createDebug[key] = env[key];
		});
		/**
		* The currently active debug mode names, and names to skip.
		*/
		createDebug.names = [];
		createDebug.skips = [];
		/**
		* Map of special "%n" handling functions, for the debug "format" argument.
		*
		* Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
		*/
		createDebug.formatters = {};
		/**
		* Selects a color for a debug namespace
		* @param {String} namespace The namespace string for the debug instance to be colored
		* @return {Number|String} An ANSI color code for the given namespace
		* @api private
		*/
		function selectColor(namespace) {
			let hash = 0;
			for (let i = 0; i < namespace.length; i++) {
				hash = (hash << 5) - hash + namespace.charCodeAt(i);
				hash |= 0;
			}
			return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
		}
		createDebug.selectColor = selectColor;
		/**
		* Create a debugger with the given `namespace`.
		*
		* @param {String} namespace
		* @return {Function}
		* @api public
		*/
		function createDebug(namespace) {
			let prevTime;
			let enableOverride = null;
			let namespacesCache;
			let enabledCache;
			function debug(...args) {
				if (!debug.enabled) return;
				const self = debug;
				const curr = Number(/* @__PURE__ */ new Date());
				self.diff = curr - (prevTime || curr);
				self.prev = prevTime;
				self.curr = curr;
				prevTime = curr;
				args[0] = createDebug.coerce(args[0]);
				if (typeof args[0] !== "string") args.unshift("%O");
				let index = 0;
				args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
					if (match === "%%") return "%";
					index++;
					const formatter = createDebug.formatters[format];
					if (typeof formatter === "function") {
						const val = args[index];
						match = formatter.call(self, val);
						args.splice(index, 1);
						index--;
					}
					return match;
				});
				createDebug.formatArgs.call(self, args);
				(self.log || createDebug.log).apply(self, args);
			}
			debug.namespace = namespace;
			debug.useColors = createDebug.useColors();
			debug.color = createDebug.selectColor(namespace);
			debug.extend = extend;
			debug.destroy = createDebug.destroy;
			Object.defineProperty(debug, "enabled", {
				enumerable: true,
				configurable: false,
				get: () => {
					if (enableOverride !== null) return enableOverride;
					if (namespacesCache !== createDebug.namespaces) {
						namespacesCache = createDebug.namespaces;
						enabledCache = createDebug.enabled(namespace);
					}
					return enabledCache;
				},
				set: (v) => {
					enableOverride = v;
				}
			});
			if (typeof createDebug.init === "function") createDebug.init(debug);
			return debug;
		}
		function extend(namespace, delimiter) {
			const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
			newDebug.log = this.log;
			return newDebug;
		}
		/**
		* Enables a debug mode by namespaces. This can include modes
		* separated by a colon and wildcards.
		*
		* @param {String} namespaces
		* @api public
		*/
		function enable(namespaces) {
			createDebug.save(namespaces);
			createDebug.namespaces = namespaces;
			createDebug.names = [];
			createDebug.skips = [];
			const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
			for (const ns of split) if (ns[0] === "-") createDebug.skips.push(ns.slice(1));
			else createDebug.names.push(ns);
		}
		/**
		* Checks if the given string matches a namespace template, honoring
		* asterisks as wildcards.
		*
		* @param {String} search
		* @param {String} template
		* @return {Boolean}
		*/
		function matchesTemplate(search, template) {
			let searchIndex = 0;
			let templateIndex = 0;
			let starIndex = -1;
			let matchIndex = 0;
			while (searchIndex < search.length) if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) if (template[templateIndex] === "*") {
				starIndex = templateIndex;
				matchIndex = searchIndex;
				templateIndex++;
			} else {
				searchIndex++;
				templateIndex++;
			}
			else if (starIndex !== -1) {
				templateIndex = starIndex + 1;
				matchIndex++;
				searchIndex = matchIndex;
			} else return false;
			while (templateIndex < template.length && template[templateIndex] === "*") templateIndex++;
			return templateIndex === template.length;
		}
		/**
		* Disable debug output.
		*
		* @return {String} namespaces
		* @api public
		*/
		function disable() {
			const namespaces = [...createDebug.names, ...createDebug.skips.map((namespace) => "-" + namespace)].join(",");
			createDebug.enable("");
			return namespaces;
		}
		/**
		* Returns true if the given mode name is enabled, false otherwise.
		*
		* @param {String} name
		* @return {Boolean}
		* @api public
		*/
		function enabled(name) {
			for (const skip of createDebug.skips) if (matchesTemplate(name, skip)) return false;
			for (const ns of createDebug.names) if (matchesTemplate(name, ns)) return true;
			return false;
		}
		/**
		* Coerce `val`.
		*
		* @param {Mixed} val
		* @return {Mixed}
		* @api private
		*/
		function coerce(val) {
			if (val instanceof Error) return val.stack || val.message;
			return val;
		}
		/**
		* XXX DO NOT USE. This is a temporary stub function.
		* XXX It WILL be removed in the next major release.
		*/
		function destroy() {
			console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
		}
		createDebug.enable(createDebug.load());
		return createDebug;
	}
	module.exports = setup;
}));
//#endregion
//#region node_modules/debug/src/browser.js
var require_browser = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* This is the web browser implementation of `debug()`.
	*/
	exports.formatArgs = formatArgs;
	exports.save = save;
	exports.load = load;
	exports.useColors = useColors;
	exports.storage = localstorage();
	exports.destroy = (() => {
		let warned = false;
		return () => {
			if (!warned) {
				warned = true;
				console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
			}
		};
	})();
	/**
	* Colors.
	*/
	exports.colors = [
		"#0000CC",
		"#0000FF",
		"#0033CC",
		"#0033FF",
		"#0066CC",
		"#0066FF",
		"#0099CC",
		"#0099FF",
		"#00CC00",
		"#00CC33",
		"#00CC66",
		"#00CC99",
		"#00CCCC",
		"#00CCFF",
		"#3300CC",
		"#3300FF",
		"#3333CC",
		"#3333FF",
		"#3366CC",
		"#3366FF",
		"#3399CC",
		"#3399FF",
		"#33CC00",
		"#33CC33",
		"#33CC66",
		"#33CC99",
		"#33CCCC",
		"#33CCFF",
		"#6600CC",
		"#6600FF",
		"#6633CC",
		"#6633FF",
		"#66CC00",
		"#66CC33",
		"#9900CC",
		"#9900FF",
		"#9933CC",
		"#9933FF",
		"#99CC00",
		"#99CC33",
		"#CC0000",
		"#CC0033",
		"#CC0066",
		"#CC0099",
		"#CC00CC",
		"#CC00FF",
		"#CC3300",
		"#CC3333",
		"#CC3366",
		"#CC3399",
		"#CC33CC",
		"#CC33FF",
		"#CC6600",
		"#CC6633",
		"#CC9900",
		"#CC9933",
		"#CCCC00",
		"#CCCC33",
		"#FF0000",
		"#FF0033",
		"#FF0066",
		"#FF0099",
		"#FF00CC",
		"#FF00FF",
		"#FF3300",
		"#FF3333",
		"#FF3366",
		"#FF3399",
		"#FF33CC",
		"#FF33FF",
		"#FF6600",
		"#FF6633",
		"#FF9900",
		"#FF9933",
		"#FFCC00",
		"#FFCC33"
	];
	/**
	* Currently only WebKit-based Web Inspectors, Firefox >= v31,
	* and the Firebug extension (any Firefox version) are known
	* to support "%c" CSS customizations.
	*
	* TODO: add a `localStorage` variable to explicitly enable/disable colors
	*/
	function useColors() {
		if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) return true;
		if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) return false;
		let m;
		return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
	}
	/**
	* Colorize log arguments if enabled.
	*
	* @api public
	*/
	function formatArgs(args) {
		args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
		if (!this.useColors) return;
		const c = "color: " + this.color;
		args.splice(1, 0, c, "color: inherit");
		let index = 0;
		let lastC = 0;
		args[0].replace(/%[a-zA-Z%]/g, (match) => {
			if (match === "%%") return;
			index++;
			if (match === "%c") lastC = index;
		});
		args.splice(lastC, 0, c);
	}
	/**
	* Invokes `console.debug()` when available.
	* No-op when `console.debug` is not a "function".
	* If `console.debug` is not available, falls back
	* to `console.log`.
	*
	* @api public
	*/
	exports.log = console.debug || console.log || (() => {});
	/**
	* Save `namespaces`.
	*
	* @param {String} namespaces
	* @api private
	*/
	function save(namespaces) {
		try {
			if (namespaces) exports.storage.setItem("debug", namespaces);
			else exports.storage.removeItem("debug");
		} catch (error) {}
	}
	/**
	* Load `namespaces`.
	*
	* @return {String} returns the previously persisted debug modes
	* @api private
	*/
	function load() {
		let r;
		try {
			r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
		} catch (error) {}
		if (!r && typeof process !== "undefined" && "env" in process) r = process.env.DEBUG;
		return r;
	}
	/**
	* Localstorage attempts to return the localstorage.
	*
	* This is necessary because safari throws
	* when a user disables cookies/localstorage
	* and you attempt to access it.
	*
	* @return {LocalStorage}
	* @api private
	*/
	function localstorage() {
		try {
			return localStorage;
		} catch (error) {}
	}
	module.exports = require_common()(exports);
	var { formatters } = module.exports;
	/**
	* Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
	*/
	formatters.j = function(v) {
		try {
			return JSON.stringify(v);
		} catch (error) {
			return "[UnexpectedJSONParseError]: " + error.message;
		}
	};
}));
//#endregion
//#region ../../../../node_modules/has-flag/index.js
var require_has_flag = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = (flag, argv = process.argv) => {
		const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
		const position = argv.indexOf(prefix + flag);
		const terminatorPosition = argv.indexOf("--");
		return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
	};
}));
//#endregion
//#region ../../../../node_modules/supports-color/index.js
var require_supports_color = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var os = __require("os");
	var tty$1 = __require("tty");
	var hasFlag = require_has_flag();
	var { env } = process;
	var flagForceColor;
	if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) flagForceColor = 0;
	else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) flagForceColor = 1;
	function envForceColor() {
		if ("FORCE_COLOR" in env) {
			if (env.FORCE_COLOR === "true") return 1;
			if (env.FORCE_COLOR === "false") return 0;
			return env.FORCE_COLOR.length === 0 ? 1 : Math.min(Number.parseInt(env.FORCE_COLOR, 10), 3);
		}
	}
	function translateLevel(level) {
		if (level === 0) return false;
		return {
			level,
			hasBasic: true,
			has256: level >= 2,
			has16m: level >= 3
		};
	}
	function supportsColor(haveStream, { streamIsTTY, sniffFlags = true } = {}) {
		const noFlagForceColor = envForceColor();
		if (noFlagForceColor !== void 0) flagForceColor = noFlagForceColor;
		const forceColor = sniffFlags ? flagForceColor : noFlagForceColor;
		if (forceColor === 0) return 0;
		if (sniffFlags) {
			if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) return 3;
			if (hasFlag("color=256")) return 2;
		}
		if (haveStream && !streamIsTTY && forceColor === void 0) return 0;
		const min = forceColor || 0;
		if (env.TERM === "dumb") return min;
		if (process.platform === "win32") {
			const osRelease = os.release().split(".");
			if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) return Number(osRelease[2]) >= 14931 ? 3 : 2;
			return 1;
		}
		if ("CI" in env) {
			if ([
				"TRAVIS",
				"CIRCLECI",
				"APPVEYOR",
				"GITLAB_CI",
				"GITHUB_ACTIONS",
				"BUILDKITE",
				"DRONE"
			].some((sign) => sign in env) || env.CI_NAME === "codeship") return 1;
			return min;
		}
		if ("TEAMCITY_VERSION" in env) return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
		if (env.COLORTERM === "truecolor") return 3;
		if ("TERM_PROGRAM" in env) {
			const version = Number.parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
			switch (env.TERM_PROGRAM) {
				case "iTerm.app": return version >= 3 ? 3 : 2;
				case "Apple_Terminal": return 2;
			}
		}
		if (/-256(color)?$/i.test(env.TERM)) return 2;
		if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) return 1;
		if ("COLORTERM" in env) return 1;
		return min;
	}
	function getSupportLevel(stream, options = {}) {
		return translateLevel(supportsColor(stream, {
			streamIsTTY: stream && stream.isTTY,
			...options
		}));
	}
	module.exports = {
		supportsColor: getSupportLevel,
		stdout: getSupportLevel({ isTTY: tty$1.isatty(1) }),
		stderr: getSupportLevel({ isTTY: tty$1.isatty(2) })
	};
}));
//#endregion
//#region node_modules/debug/src/node.js
var require_node = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Module dependencies.
	*/
	var tty = __require("tty");
	var util = __require("util");
	/**
	* This is the Node.js implementation of `debug()`.
	*/
	exports.init = init;
	exports.log = log;
	exports.formatArgs = formatArgs;
	exports.save = save;
	exports.load = load;
	exports.useColors = useColors;
	exports.destroy = util.deprecate(() => {}, "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
	/**
	* Colors.
	*/
	exports.colors = [
		6,
		2,
		3,
		4,
		5,
		1
	];
	try {
		const supportsColor = require_supports_color();
		if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) exports.colors = [
			20,
			21,
			26,
			27,
			32,
			33,
			38,
			39,
			40,
			41,
			42,
			43,
			44,
			45,
			56,
			57,
			62,
			63,
			68,
			69,
			74,
			75,
			76,
			77,
			78,
			79,
			80,
			81,
			92,
			93,
			98,
			99,
			112,
			113,
			128,
			129,
			134,
			135,
			148,
			149,
			160,
			161,
			162,
			163,
			164,
			165,
			166,
			167,
			168,
			169,
			170,
			171,
			172,
			173,
			178,
			179,
			184,
			185,
			196,
			197,
			198,
			199,
			200,
			201,
			202,
			203,
			204,
			205,
			206,
			207,
			208,
			209,
			214,
			215,
			220,
			221
		];
	} catch (error) {}
	/**
	* Build up the default `inspectOpts` object from the environment variables.
	*
	*   $ DEBUG_COLORS=no DEBUG_DEPTH=10 DEBUG_SHOW_HIDDEN=enabled node script.js
	*/
	exports.inspectOpts = Object.keys(process.env).filter((key) => {
		return /^debug_/i.test(key);
	}).reduce((obj, key) => {
		const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
			return k.toUpperCase();
		});
		let val = process.env[key];
		if (/^(yes|on|true|enabled)$/i.test(val)) val = true;
		else if (/^(no|off|false|disabled)$/i.test(val)) val = false;
		else if (val === "null") val = null;
		else val = Number(val);
		obj[prop] = val;
		return obj;
	}, {});
	/**
	* Is stdout a TTY? Colored output is enabled when `true`.
	*/
	function useColors() {
		return "colors" in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(process.stderr.fd);
	}
	/**
	* Adds ANSI color escape codes if enabled.
	*
	* @api public
	*/
	function formatArgs(args) {
		const { namespace: name, useColors } = this;
		if (useColors) {
			const c = this.color;
			const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
			const prefix = `  ${colorCode};1m${name} \u001B[0m`;
			args[0] = prefix + args[0].split("\n").join("\n" + prefix);
			args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
		} else args[0] = getDate() + name + " " + args[0];
	}
	function getDate() {
		if (exports.inspectOpts.hideDate) return "";
		return (/* @__PURE__ */ new Date()).toISOString() + " ";
	}
	/**
	* Invokes `util.formatWithOptions()` with the specified arguments and writes to stderr.
	*/
	function log(...args) {
		return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + "\n");
	}
	/**
	* Save `namespaces`.
	*
	* @param {String} namespaces
	* @api private
	*/
	function save(namespaces) {
		if (namespaces) process.env.DEBUG = namespaces;
		else delete process.env.DEBUG;
	}
	/**
	* Load `namespaces`.
	*
	* @return {String} returns the previously persisted debug modes
	* @api private
	*/
	function load() {
		return process.env.DEBUG;
	}
	/**
	* Init logic for `debug` instances.
	*
	* Create a new `inspectOpts` object in case `useColors` is set
	* differently for a particular `debug` instance.
	*/
	function init(debug) {
		debug.inspectOpts = {};
		const keys = Object.keys(exports.inspectOpts);
		for (let i = 0; i < keys.length; i++) debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
	}
	module.exports = require_common()(exports);
	var { formatters } = module.exports;
	/**
	* Map %o to `util.inspect()`, all on a single line.
	*/
	formatters.o = function(v) {
		this.inspectOpts.colors = this.useColors;
		return util.inspect(v, this.inspectOpts).split("\n").map((str) => str.trim()).join(" ");
	};
	/**
	* Map %O to `util.inspect()`, allowing multiple lines if needed.
	*/
	formatters.O = function(v) {
		this.inspectOpts.colors = this.useColors;
		return util.inspect(v, this.inspectOpts);
	};
}));
//#endregion
//#region node_modules/debug/src/index.js
var require_src = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Detect Electron renderer / nwjs process, which is node, but we should
	* treat as a browser.
	*/
	if (typeof process === "undefined" || process.type === "renderer" || process.browser === true || process.__nwjs) module.exports = require_browser();
	else module.exports = require_node();
}));
//#endregion
//#region node_modules/agent-base/dist/helpers.js
var require_helpers = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar = exports && exports.__importStar || function(mod) {
		if (mod && mod.__esModule) return mod;
		var result = {};
		if (mod != null) {
			for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
		}
		__setModuleDefault(result, mod);
		return result;
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.req = exports.json = exports.toBuffer = void 0;
	var http$1 = __importStar(__require("http"));
	var https = __importStar(__require("https"));
	async function toBuffer(stream) {
		let length = 0;
		const chunks = [];
		for await (const chunk of stream) {
			length += chunk.length;
			chunks.push(chunk);
		}
		return Buffer.concat(chunks, length);
	}
	exports.toBuffer = toBuffer;
	async function json(stream) {
		const str = (await toBuffer(stream)).toString("utf8");
		try {
			return JSON.parse(str);
		} catch (_err) {
			const err = _err;
			err.message += ` (input: ${str})`;
			throw err;
		}
	}
	exports.json = json;
	function req(url, opts = {}) {
		const req = ((typeof url === "string" ? url : url.href).startsWith("https:") ? https : http$1).request(url, opts);
		const promise = new Promise((resolve, reject) => {
			req.once("response", resolve).once("error", reject).end();
		});
		req.then = promise.then.bind(promise);
		return req;
	}
	exports.req = req;
}));
//#endregion
//#region node_modules/agent-base/dist/index.js
var require_dist$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar = exports && exports.__importStar || function(mod) {
		if (mod && mod.__esModule) return mod;
		var result = {};
		if (mod != null) {
			for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
		}
		__setModuleDefault(result, mod);
		return result;
	};
	var __exportStar = exports && exports.__exportStar || function(m, exports$1) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$1, p)) __createBinding(exports$1, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Agent = void 0;
	var net$1 = __importStar(__require("net"));
	var http = __importStar(__require("http"));
	var https_1 = __require("https");
	__exportStar(require_helpers(), exports);
	var INTERNAL = Symbol("AgentBaseInternalState");
	var Agent = class extends http.Agent {
		constructor(opts) {
			super(opts);
			this[INTERNAL] = {};
		}
		/**
		* Determine whether this is an `http` or `https` request.
		*/
		isSecureEndpoint(options) {
			if (options) {
				if (typeof options.secureEndpoint === "boolean") return options.secureEndpoint;
				if (typeof options.protocol === "string") return options.protocol === "https:";
			}
			const { stack } = /* @__PURE__ */ new Error();
			if (typeof stack !== "string") return false;
			return stack.split("\n").some((l) => l.indexOf("(https.js:") !== -1 || l.indexOf("node:https:") !== -1);
		}
		incrementSockets(name) {
			if (this.maxSockets === Infinity && this.maxTotalSockets === Infinity) return null;
			if (!this.sockets[name]) this.sockets[name] = [];
			const fakeSocket = new net$1.Socket({ writable: false });
			this.sockets[name].push(fakeSocket);
			this.totalSocketCount++;
			return fakeSocket;
		}
		decrementSockets(name, socket) {
			if (!this.sockets[name] || socket === null) return;
			const sockets = this.sockets[name];
			const index = sockets.indexOf(socket);
			if (index !== -1) {
				sockets.splice(index, 1);
				this.totalSocketCount--;
				if (sockets.length === 0) delete this.sockets[name];
			}
		}
		getName(options) {
			if (this.isSecureEndpoint(options)) return https_1.Agent.prototype.getName.call(this, options);
			return super.getName(options);
		}
		createSocket(req, options, cb) {
			const connectOpts = {
				...options,
				secureEndpoint: this.isSecureEndpoint(options)
			};
			const name = this.getName(connectOpts);
			const fakeSocket = this.incrementSockets(name);
			Promise.resolve().then(() => this.connect(req, connectOpts)).then((socket) => {
				this.decrementSockets(name, fakeSocket);
				if (socket instanceof http.Agent) try {
					return socket.addRequest(req, connectOpts);
				} catch (err) {
					return cb(err);
				}
				this[INTERNAL].currentSocket = socket;
				super.createSocket(req, options, cb);
			}, (err) => {
				this.decrementSockets(name, fakeSocket);
				cb(err);
			});
		}
		createConnection() {
			const socket = this[INTERNAL].currentSocket;
			this[INTERNAL].currentSocket = void 0;
			if (!socket) throw new Error("No socket was returned in the `connect()` function");
			return socket;
		}
		get defaultPort() {
			return this[INTERNAL].defaultPort ?? (this.protocol === "https:" ? 443 : 80);
		}
		set defaultPort(v) {
			if (this[INTERNAL]) this[INTERNAL].defaultPort = v;
		}
		get protocol() {
			return this[INTERNAL].protocol ?? (this.isSecureEndpoint() ? "https:" : "http:");
		}
		set protocol(v) {
			if (this[INTERNAL]) this[INTERNAL].protocol = v;
		}
	};
	exports.Agent = Agent;
}));
//#endregion
//#region node_modules/https-proxy-agent/dist/parse-proxy-response.js
var require_parse_proxy_response = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.parseProxyResponse = void 0;
	var debug = (0, __importDefault(require_src()).default)("https-proxy-agent:parse-proxy-response");
	function parseProxyResponse(socket) {
		return new Promise((resolve, reject) => {
			let buffersLength = 0;
			const buffers = [];
			function read() {
				const b = socket.read();
				if (b) ondata(b);
				else socket.once("readable", read);
			}
			function cleanup() {
				socket.removeListener("end", onend);
				socket.removeListener("error", onerror);
				socket.removeListener("readable", read);
			}
			function onend() {
				cleanup();
				debug("onend");
				reject(/* @__PURE__ */ new Error("Proxy connection ended before receiving CONNECT response"));
			}
			function onerror(err) {
				cleanup();
				debug("onerror %o", err);
				reject(err);
			}
			function ondata(b) {
				buffers.push(b);
				buffersLength += b.length;
				const buffered = Buffer.concat(buffers, buffersLength);
				const endOfHeaders = buffered.indexOf("\r\n\r\n");
				if (endOfHeaders === -1) {
					debug("have not received end of HTTP headers yet...");
					read();
					return;
				}
				const headerParts = buffered.slice(0, endOfHeaders).toString("ascii").split("\r\n");
				const firstLine = headerParts.shift();
				if (!firstLine) {
					socket.destroy();
					return reject(/* @__PURE__ */ new Error("No header received from proxy CONNECT response"));
				}
				const firstLineParts = firstLine.split(" ");
				const statusCode = +firstLineParts[1];
				const statusText = firstLineParts.slice(2).join(" ");
				const headers = {};
				for (const header of headerParts) {
					if (!header) continue;
					const firstColon = header.indexOf(":");
					if (firstColon === -1) {
						socket.destroy();
						return reject(/* @__PURE__ */ new Error(`Invalid header from proxy CONNECT response: "${header}"`));
					}
					const key = header.slice(0, firstColon).toLowerCase();
					const value = header.slice(firstColon + 1).trimStart();
					const current = headers[key];
					if (typeof current === "string") headers[key] = [current, value];
					else if (Array.isArray(current)) current.push(value);
					else headers[key] = value;
				}
				debug("got proxy server response: %o %o", firstLine, headers);
				cleanup();
				resolve({
					connect: {
						statusCode,
						statusText,
						headers
					},
					buffered
				});
			}
			socket.on("error", onerror);
			socket.on("end", onend);
			read();
		});
	}
	exports.parseProxyResponse = parseProxyResponse;
}));
//#endregion
//#region node_modules/https-proxy-agent/dist/index.js
var require_dist = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar = exports && exports.__importStar || function(mod) {
		if (mod && mod.__esModule) return mod;
		var result = {};
		if (mod != null) {
			for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
		}
		__setModuleDefault(result, mod);
		return result;
	};
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.HttpsProxyAgent = void 0;
	var net = __importStar(__require("net"));
	var tls = __importStar(__require("tls"));
	var assert_1 = __importDefault(__require("assert"));
	var debug_1 = __importDefault(require_src());
	var agent_base_1 = require_dist$1();
	var url_1 = __require("url");
	var parse_proxy_response_1 = require_parse_proxy_response();
	var debug = (0, debug_1.default)("https-proxy-agent");
	var setServernameFromNonIpHost = (options) => {
		if (options.servername === void 0 && options.host && !net.isIP(options.host)) return {
			...options,
			servername: options.host
		};
		return options;
	};
	/**
	* The `HttpsProxyAgent` implements an HTTP Agent subclass that connects to
	* the specified "HTTP(s) proxy server" in order to proxy HTTPS requests.
	*
	* Outgoing HTTP requests are first tunneled through the proxy server using the
	* `CONNECT` HTTP request method to establish a connection to the proxy server,
	* and then the proxy server connects to the destination target and issues the
	* HTTP request from the proxy server.
	*
	* `https:` requests have their socket connection upgraded to TLS once
	* the connection to the proxy server has been established.
	*/
	var HttpsProxyAgent = class extends agent_base_1.Agent {
		constructor(proxy, opts) {
			super(opts);
			this.options = { path: void 0 };
			this.proxy = typeof proxy === "string" ? new url_1.URL(proxy) : proxy;
			this.proxyHeaders = opts?.headers ?? {};
			debug("Creating new HttpsProxyAgent instance: %o", this.proxy.href);
			const host = (this.proxy.hostname || this.proxy.host).replace(/^\[|\]$/g, "");
			const port = this.proxy.port ? parseInt(this.proxy.port, 10) : this.proxy.protocol === "https:" ? 443 : 80;
			this.connectOpts = {
				ALPNProtocols: ["http/1.1"],
				...opts ? omit(opts, "headers") : null,
				host,
				port
			};
		}
		/**
		* Called when the node-core HTTP client library is creating a
		* new HTTP request.
		*/
		async connect(req, opts) {
			const { proxy } = this;
			if (!opts.host) throw new TypeError("No \"host\" provided");
			let socket;
			if (proxy.protocol === "https:") {
				debug("Creating `tls.Socket`: %o", this.connectOpts);
				socket = tls.connect(setServernameFromNonIpHost(this.connectOpts));
			} else {
				debug("Creating `net.Socket`: %o", this.connectOpts);
				socket = net.connect(this.connectOpts);
			}
			const headers = typeof this.proxyHeaders === "function" ? this.proxyHeaders() : { ...this.proxyHeaders };
			const host = net.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
			let payload = `CONNECT ${host}:${opts.port} HTTP/1.1\r\n`;
			if (proxy.username || proxy.password) {
				const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
				headers["Proxy-Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;
			}
			headers.Host = `${host}:${opts.port}`;
			if (!headers["Proxy-Connection"]) headers["Proxy-Connection"] = this.keepAlive ? "Keep-Alive" : "close";
			for (const name of Object.keys(headers)) payload += `${name}: ${headers[name]}\r\n`;
			const proxyResponsePromise = (0, parse_proxy_response_1.parseProxyResponse)(socket);
			socket.write(`${payload}\r\n`);
			const { connect, buffered } = await proxyResponsePromise;
			req.emit("proxyConnect", connect);
			this.emit("proxyConnect", connect, req);
			if (connect.statusCode === 200) {
				req.once("socket", resume);
				if (opts.secureEndpoint) {
					debug("Upgrading socket connection to TLS");
					return tls.connect({
						...omit(setServernameFromNonIpHost(opts), "host", "path", "port"),
						socket
					});
				}
				return socket;
			}
			socket.destroy();
			const fakeSocket = new net.Socket({ writable: false });
			fakeSocket.readable = true;
			req.once("socket", (s) => {
				debug("Replaying proxy buffer for failed request");
				(0, assert_1.default)(s.listenerCount("data") > 0);
				s.push(buffered);
				s.push(null);
			});
			return fakeSocket;
		}
	};
	HttpsProxyAgent.protocols = ["http", "https"];
	exports.HttpsProxyAgent = HttpsProxyAgent;
	function resume(socket) {
		socket.resume();
	}
	function omit(obj, ...keys) {
		const ret = {};
		let key;
		for (key in obj) if (!keys.includes(key)) ret[key] = obj[key];
		return ret;
	}
}));
//#endregion
export default require_dist();
export {};
