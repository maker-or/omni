import { clerkJSScriptUrl, clerkUIScriptUrl } from "@clerk/shared/loadClerkJsScript";
import { createClerkClient } from "@clerk/backend";
import {
  createClerkRequest,
  constants,
  AuthStatus,
  TokenType,
  signedOutAuthObject,
  getAuthObjectForAcceptedToken,
  createRedirect,
} from "@clerk/backend/internal";
import { isDevelopmentFromSecretKey } from "@clerk/shared/keys";
import { handleNetlifyCacheInDevInstance } from "@clerk/shared/netlifyCacheHandler";
import { isMalformedURLError } from "@clerk/shared/pathMatcher";
import { isHttpOrHttps } from "@clerk/shared/proxy";
import {
  isDevelopmentEnvironment,
  isAutomatedEnvironment,
  handleValueOrFn,
} from "@clerk/shared/utils";
import { getEnvVariable } from "@clerk/shared/getEnvVariable";
import { isTruthy } from "@clerk/shared/underscore";
import {
  resolveKeysWithKeylessFallback,
  createKeylessService,
  createNodeFileStorage,
} from "@clerk/shared/keyless";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { DEV_BROWSER_KEY, setDevBrowserInURL } from "@clerk/shared/devBrowser";
async function createAsyncLocalStorage() {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return new AsyncLocalStorage();
}
const authAsyncStorage = await createAsyncLocalStorage();
const __vite_import_meta_env__ = {
  ASSETS_PREFIX: void 0,
  BASE_URL: "/",
  DEV: false,
  MODE: "production",
  PROD: true,
  PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_c3dlZXBpbmctbW90aC01Mi5jbGVyay5hY2NvdW50cy5kZXYk",
  SITE: void 0,
  SSR: true,
};
const KEYLESS_DISABLED =
  isTruthy(getEnvVariable("PUBLIC_CLERK_KEYLESS_DISABLED")) ||
  isTruthy(getEnvVariable("CLERK_KEYLESS_DISABLED")) ||
  false;
const canUseKeyless = isDevelopmentEnvironment() && !isAutomatedEnvironment() && !KEYLESS_DISABLED;
let cloudflareEnv;
async function initCloudflareEnv() {
  if (cloudflareEnv !== void 0) return;
  try {
    cloudflareEnv = (
      await import(
        /* @vite-ignore */
        "cloudflare:workers"
      )
    ).env;
  } catch {
    cloudflareEnv = null;
  }
}
function getContextEnvVar(envVarName, contextOrLocals) {
  const locals = "locals" in contextOrLocals ? contextOrLocals.locals : contextOrLocals;
  if (cloudflareEnv) {
    const value = cloudflareEnv[envVarName];
    if (value !== void 0) return value;
  }
  try {
    if (locals?.runtime?.env) return locals.runtime.env[envVarName];
  } catch {}
  if (typeof process !== "undefined" && process.env?.[envVarName]) return process.env[envVarName];
  return (
    Object.assign(__vite_import_meta_env__, {
      CLERK_SECRET_KEY: "your-clerk-secret-key-placeholder",
      _: "/Users/harshithpasupuleti/code/omni/marketing/node_modules/.bin/astro",
      LESS: "-R",
    })[envVarName] || void 0
  );
}
function getSafeEnv(context) {
  const locals = "locals" in context ? context.locals : context;
  return {
    domain: getContextEnvVar("PUBLIC_CLERK_DOMAIN", context),
    isSatellite: getContextEnvVar("PUBLIC_CLERK_IS_SATELLITE", context) === "true",
    proxyUrl: getContextEnvVar("PUBLIC_CLERK_PROXY_URL", context),
    pk: locals.keylessPublishableKey || getContextEnvVar("PUBLIC_CLERK_PUBLISHABLE_KEY", context),
    sk: getContextEnvVar("CLERK_SECRET_KEY", context),
    machineSecretKey: getContextEnvVar("CLERK_MACHINE_SECRET_KEY", context),
    signInUrl: getContextEnvVar("PUBLIC_CLERK_SIGN_IN_URL", context),
    signUpUrl: getContextEnvVar("PUBLIC_CLERK_SIGN_UP_URL", context),
    clerkJsUrl: getContextEnvVar("PUBLIC_CLERK_JS_URL", context),
    clerkJsVersion: getContextEnvVar("PUBLIC_CLERK_JS_VERSION", context),
    clerkUIUrl: getContextEnvVar("PUBLIC_CLERK_UI_URL", context),
    clerkUIVersion: getContextEnvVar("PUBLIC_CLERK_UI_VERSION", context),
    prefetchUI: getContextEnvVar("PUBLIC_CLERK_PREFETCH_UI", context) === "false" ? false : void 0,
    apiVersion: getContextEnvVar("CLERK_API_VERSION", context),
    apiUrl: getContextEnvVar("CLERK_API_URL", context),
    telemetryDisabled: isTruthy(getContextEnvVar("PUBLIC_CLERK_TELEMETRY_DISABLED", context)),
    telemetryDebug: isTruthy(getContextEnvVar("PUBLIC_CLERK_TELEMETRY_DEBUG", context)),
    keylessClaimUrl: locals.keylessClaimUrl,
    keylessApiKeysUrl: locals.keylessApiKeysUrl,
  };
}
function getClientSafeEnv(context) {
  const locals = "locals" in context ? context.locals : context;
  return {
    domain: getContextEnvVar("PUBLIC_CLERK_DOMAIN", context),
    isSatellite: getContextEnvVar("PUBLIC_CLERK_IS_SATELLITE", context) === "true",
    proxyUrl: getContextEnvVar("PUBLIC_CLERK_PROXY_URL", context),
    signInUrl: getContextEnvVar("PUBLIC_CLERK_SIGN_IN_URL", context),
    signUpUrl: getContextEnvVar("PUBLIC_CLERK_SIGN_UP_URL", context),
    publishableKey:
      locals.keylessPublishableKey || getContextEnvVar("PUBLIC_CLERK_PUBLISHABLE_KEY", context),
    keylessClaimUrl: locals.keylessClaimUrl,
    keylessApiKeysUrl: locals.keylessApiKeysUrl,
  };
}
function buildClerkHotloadScript(locals) {
  const env = getSafeEnv(locals);
  const publishableKey = env.pk;
  const proxyUrl = env.proxyUrl;
  const domain = env.domain;
  const clerkJsScript = `
  <script src="${clerkJSScriptUrl({
    __internal_clerkJSUrl: env.clerkJsUrl,
    __internal_clerkJSVersion: env.clerkJsVersion,
    domain,
    proxyUrl,
    publishableKey,
  })}"
  data-clerk-js-script
  async
  crossOrigin='anonymous'
  ${publishableKey ? `data-clerk-publishable-key="${publishableKey}"` : ``}
  ${proxyUrl ? `data-clerk-proxy-url="${proxyUrl}"` : ``}
  ${domain ? `data-clerk-domain="${domain}"` : ``}
  ><\/script>`;
  if (env.prefetchUI === false) return clerkJsScript + "\n";
  return (
    clerkJsScript +
    `
  <link rel="preload"
  href="${clerkUIScriptUrl({
    __internal_clerkUIUrl: env.clerkUIUrl,
    __internal_clerkUIVersion: env.clerkUIVersion,
    domain,
    proxyUrl,
    publishableKey,
  })}"
  as="script"
  crossOrigin="anonymous"
  />
`
  );
}
const createClerkClientWithOptions = (context, options) =>
  createClerkClient({
    secretKey: getSafeEnv(context).sk,
    machineSecretKey: getSafeEnv(context).machineSecretKey,
    publishableKey: getSafeEnv(context).pk,
    apiUrl: getSafeEnv(context).apiUrl,
    apiVersion: getSafeEnv(context).apiVersion,
    proxyUrl: getSafeEnv(context).proxyUrl,
    domain: getSafeEnv(context).domain,
    isSatellite: getSafeEnv(context).isSatellite,
    userAgent: `@clerk/astro@3.4.2`,
    sdkMetadata: {
      name: "@clerk/astro",
      version: "3.4.2",
      environment: Object.assign(__vite_import_meta_env__, {
        CLERK_SECRET_KEY: "your-clerk-secret-key-placeholder",
        _: "/Users/harshithpasupuleti/code/omni/marketing/node_modules/.bin/astro",
        LESS: "-R",
      }).MODE,
    },
    telemetry: {
      disabled: getSafeEnv(context).telemetryDisabled,
      debug: getSafeEnv(context).telemetryDebug,
    },
    ...options,
  });
const clerkClient = (context) => createClerkClientWithOptions(context);
const createCurrentUser = (context) => {
  return async () => {
    const { userId } = context.locals.auth();
    if (!userId) return null;
    return clerkClient(context).users.getUser(userId);
  };
};
function createFileStorage(options = {}) {
  const { cwd = () => process.cwd() } = options;
  return createNodeFileStorage(fs, nodePath, {
    cwd,
    frameworkPackageName: "@clerk/astro",
  });
}
let keylessServiceInstance = null;
function keyless(context) {
  if (!keylessServiceInstance)
    keylessServiceInstance = createKeylessService({
      storage: createFileStorage(),
      api: {
        async createAccountlessApplication(requestHeaders, source) {
          try {
            return await clerkClient(
              context,
            ).__experimental_accountlessApplications.createAccountlessApplication({
              requestHeaders,
              source,
            });
          } catch {
            return null;
          }
        },
        async completeOnboarding(requestHeaders, source) {
          try {
            return await clerkClient(
              context,
            ).__experimental_accountlessApplications.completeAccountlessApplicationOnboarding({
              requestHeaders,
              source,
            });
          } catch {
            return null;
          }
        },
      },
      framework: "astro",
    });
  return keylessServiceInstance;
}
async function resolveKeysWithKeylessFallback$1(
  configuredPublishableKey,
  configuredSecretKey,
  context,
) {
  return resolveKeysWithKeylessFallback(
    configuredPublishableKey,
    configuredSecretKey,
    await keyless(context),
    canUseKeyless,
  );
}
const serverRedirectWithAuth = (context, clerkRequest, res, opts) => {
  const location = res.headers.get("location");
  if (
    res.headers.get(constants.Headers.ClerkRedirectTo) === "true" &&
    !!location &&
    isDevelopmentFromSecretKey(opts.secretKey || getSafeEnv(context).sk) &&
    clerkRequest.clerkUrl.isCrossOrigin(location)
  ) {
    const devBrowser = clerkRequest.cookies.get(DEV_BROWSER_KEY) || "";
    const urlWithDevBrowser = setDevBrowserInURL(new URL(location), devBrowser);
    return context.redirect(urlWithDevBrowser.href, 307);
  }
  return res;
};
const isRedirect = (res) => {
  return (
    [300, 301, 302, 303, 304, 307, 308].includes(res.status) ||
    res.headers.get(constants.Headers.ClerkRedirectTo) === "true"
  );
};
const setHeader = (res, name, val) => {
  res.headers.set(name, val);
  return res;
};
const CONTROL_FLOW_ERROR = { REDIRECT_TO_SIGN_IN: "CLERK_PROTECT_REDIRECT_TO_SIGN_IN" };
const clerkMiddleware = (...args) => {
  const [handler, options] = parseHandlerAndOptions(args);
  const astroMiddleware = async (context, next) => {
    if (isPrerenderedPage(context)) return next();
    await initCloudflareEnv();
    const clerkRequest = createClerkRequest(context.request);
    let keylessClaimUrl;
    let keylessApiKeysUrl;
    let keylessOptions = options;
    if (canUseKeyless)
      try {
        const env = getSafeEnv(context);
        const keylessResult = await resolveKeysWithKeylessFallback$1(
          options?.publishableKey || env.pk,
          options?.secretKey || env.sk,
          context,
        );
        keylessClaimUrl = keylessResult.claimUrl;
        keylessApiKeysUrl = keylessResult.apiKeysUrl;
        if (keylessResult.publishableKey || keylessResult.secretKey)
          keylessOptions = {
            ...options,
            ...(keylessResult.publishableKey && { publishableKey: keylessResult.publishableKey }),
            ...(keylessResult.secretKey && { secretKey: keylessResult.secretKey }),
          };
      } catch {}
    const requestState = await clerkClient(context).authenticateRequest(
      clerkRequest,
      createAuthenticateRequestOptions(clerkRequest, keylessOptions, context),
    );
    const locationHeader = requestState.headers.get(constants.Headers.Location);
    if (locationHeader) {
      handleNetlifyCacheInDevInstance({
        locationHeader,
        requestStateHeaders: requestState.headers,
        publishableKey: requestState.publishableKey,
      });
      return decorateResponseWithObservabilityHeaders(
        new Response(null, {
          status: 307,
          headers: requestState.headers,
        }),
        requestState,
      );
    } else if (requestState.status === AuthStatus.Handshake)
      throw new Error("Clerk: handshake status without redirect");
    const authObjectFn = (opts) => requestState.toAuth(opts);
    const redirectToSignIn = createMiddlewareRedirectToSignIn(clerkRequest);
    decorateAstroLocal(clerkRequest, authObjectFn, context, requestState);
    if (keylessClaimUrl || keylessApiKeysUrl) {
      context.locals.keylessClaimUrl = keylessClaimUrl;
      context.locals.keylessApiKeysUrl = keylessApiKeysUrl;
      if (keylessOptions?.publishableKey)
        context.locals.keylessPublishableKey = keylessOptions.publishableKey;
    }
    const asyncStorageAuthObject =
      authObjectFn().tokenType === TokenType.SessionToken
        ? authObjectFn()
        : signedOutAuthObject({});
    const authHandler = (opts) => {
      const authObject = getAuthObjectForAcceptedToken({
        authObject: authObjectFn({ treatPendingAsSignedOut: opts?.treatPendingAsSignedOut }),
        acceptsToken: opts?.acceptsToken,
      });
      if (authObject.tokenType === TokenType.SessionToken)
        return Object.assign(authObject, { redirectToSignIn });
      return authObject;
    };
    return authAsyncStorage.run(asyncStorageAuthObject, async () => {
      let handlerResult;
      try {
        handlerResult = (await handler?.(authHandler, context, next)) || (await next());
      } catch (e) {
        handlerResult = handleControlFlowErrors(e, clerkRequest, requestState, context);
      }
      if (isRedirect(handlerResult))
        return serverRedirectWithAuth(context, clerkRequest, handlerResult, options);
      const response = decorateRequest(context.locals, handlerResult);
      if (requestState.headers)
        requestState.headers.forEach((value, key) => {
          response.headers.append(key, value);
        });
      return response;
    });
  };
  return astroMiddleware;
};
const isPrerenderedPage = (context) => {
  return (
    ("isPrerendered" in context && context.isPrerendered) ||
    ("_isPrerendered" in context && context._isPrerendered)
  );
};
const parseHandlerAndOptions = (args) => {
  return [
    typeof args[0] === "function" ? args[0] : void 0,
    (args.length === 2 ? args[1] : typeof args[0] === "function" ? {} : args[0]) || {},
  ];
};
const createAuthenticateRequestOptions = (clerkRequest, options, context) => {
  return {
    ...options,
    secretKey: options.secretKey || getSafeEnv(context).sk,
    publishableKey: options.publishableKey || getSafeEnv(context).pk,
    signInUrl: options.signInUrl || getSafeEnv(context).signInUrl,
    signUpUrl: options.signUpUrl || getSafeEnv(context).signUpUrl,
    ...handleMultiDomainAndProxy(clerkRequest, options, context),
    acceptsToken: "any",
  };
};
const decorateResponseWithObservabilityHeaders = (res, requestState) => {
  if (requestState.message)
    res.headers.set(constants.Headers.AuthMessage, encodeURIComponent(requestState.message));
  if (requestState.reason)
    res.headers.set(constants.Headers.AuthReason, encodeURIComponent(requestState.reason));
  if (requestState.status)
    res.headers.set(constants.Headers.AuthStatus, encodeURIComponent(requestState.status));
  return res;
};
const handleMultiDomainAndProxy = (clerkRequest, opts, context) => {
  const relativeOrAbsoluteProxyUrl = handleValueOrFn(
    opts?.proxyUrl,
    clerkRequest.clerkUrl,
    getSafeEnv(context).proxyUrl,
  );
  let proxyUrl;
  if (!!relativeOrAbsoluteProxyUrl && !isHttpOrHttps(relativeOrAbsoluteProxyUrl))
    proxyUrl = new URL(relativeOrAbsoluteProxyUrl, clerkRequest.clerkUrl).toString();
  else proxyUrl = relativeOrAbsoluteProxyUrl;
  const isSatellite = handleValueOrFn(
    opts.isSatellite,
    new URL(clerkRequest.url),
    getSafeEnv(context).isSatellite,
  );
  const domain = handleValueOrFn(
    opts.domain,
    new URL(clerkRequest.url),
    getSafeEnv(context).domain,
  );
  const signInUrl = opts?.signInUrl || getSafeEnv(context).signInUrl;
  if (isSatellite && !proxyUrl && !domain) throw new Error(missingDomainAndProxy);
  if (
    isSatellite &&
    !isHttpOrHttps(signInUrl) &&
    isDevelopmentFromSecretKey(opts.secretKey || getSafeEnv(context).sk)
  )
    throw new Error(missingSignInUrlInDev);
  return {
    proxyUrl,
    isSatellite,
    domain,
  };
};
const missingDomainAndProxy = `
Missing domain and proxyUrl. A satellite application needs to specify a domain or a proxyUrl.

1) With middleware
   e.g. export default clerkMiddleware({domain:'YOUR_DOMAIN',isSatellite:true});
2) With environment variables e.g.
   PUBLIC_CLERK_DOMAIN='YOUR_DOMAIN'
   PUBLIC_CLERK_IS_SATELLITE='true'
   `;
const missingSignInUrlInDev = `
Invalid signInUrl. A satellite application requires a signInUrl for development instances.
Check if signInUrl is missing from your configuration or if it is not an absolute URL

1) With middleware
   e.g. export default clerkMiddleware({signInUrl:'SOME_URL', isSatellite:true});
2) With environment variables e.g.
   PUBLIC_CLERK_SIGN_IN_URL='SOME_URL'
   PUBLIC_CLERK_IS_SATELLITE='true'`;
function decorateAstroLocal(clerkRequest, authObjectFn, context, requestState) {
  const { reason, message, status, token } = requestState;
  context.locals.authToken = token;
  context.locals.authStatus = status;
  context.locals.authMessage = message;
  context.locals.authReason = reason;
  context.locals.auth = ({ acceptsToken, treatPendingAsSignedOut } = {}) => {
    const authObject = getAuthObjectForAcceptedToken({
      authObject: authObjectFn({ treatPendingAsSignedOut }),
      acceptsToken,
    });
    if (authObject.tokenType === TokenType.SessionToken) {
      const clerkUrl = clerkRequest.clerkUrl;
      const redirectToSignIn = (opts = {}) => {
        return createRedirect({
          redirectAdapter,
          devBrowserToken:
            clerkRequest.clerkUrl.searchParams.get(constants.QueryParameters.DevBrowser) ||
            clerkRequest.cookies.get(constants.Cookies.DevBrowser),
          baseUrl: clerkUrl.toString(),
          publishableKey: getSafeEnv(context).pk,
          signInUrl: requestState.signInUrl,
          signUpUrl: requestState.signUpUrl,
          sessionStatus: requestState.toAuth()?.sessionStatus,
          isSatellite: requestState.isSatellite,
        }).redirectToSignIn({
          returnBackUrl:
            opts.returnBackUrl === null ? "" : opts.returnBackUrl || clerkUrl.toString(),
        });
      };
      return Object.assign(authObject, { redirectToSignIn });
    }
    return authObject;
  };
  context.locals.currentUser = createCurrentUser(context);
}
function findClosingHeadTagIndex(chunk, endHeadTag) {
  return chunk.findIndex((_, i) => endHeadTag.every((value, j) => value === chunk[i + j]));
}
function decorateRequest(locals, res) {
  if (res.headers.get("content-type") === "text/html") {
    const encoder = new TextEncoder();
    const closingHeadTag = encoder.encode("</head>");
    const clerkAstroData =
      encoder.encode(`<script id="__CLERK_ASTRO_DATA__" type="application/json">${JSON.stringify(locals.auth())}<\/script>
`);
    const clerkSafeEnvVariables =
      encoder.encode(`<script id="__CLERK_ASTRO_SAFE_VARS__" type="application/json">${JSON.stringify(getClientSafeEnv(locals))}<\/script>
`);
    const hotloadScript = encoder.encode(buildClerkHotloadScript(locals));
    const stream = res.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          const index = findClosingHeadTagIndex(chunk, closingHeadTag);
          if (index !== -1) {
            controller.enqueue(chunk.slice(0, index));
            controller.enqueue(clerkAstroData);
            controller.enqueue(clerkSafeEnvVariables);
            controller.enqueue(hotloadScript);
            controller.enqueue(closingHeadTag);
            controller.enqueue(chunk.slice(index + closingHeadTag.length));
          } else controller.enqueue(chunk);
        },
      }),
    );
    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }
  return res;
}
const redirectAdapter = (url) => {
  const res = new Response(null, { status: 307 });
  setHeader(res, constants.Headers.ClerkRedirectTo, "true");
  return setHeader(res, "Location", url instanceof URL ? url.href : url);
};
const createMiddlewareRedirectToSignIn = (clerkRequest) => {
  return (opts = {}) => {
    const err = new Error(CONTROL_FLOW_ERROR.REDIRECT_TO_SIGN_IN);
    err.returnBackUrl =
      opts.returnBackUrl === null ? "" : opts.returnBackUrl || clerkRequest.clerkUrl.toString();
    throw err;
  };
};
const handleControlFlowErrors = (e, clerkRequest, requestState, context) => {
  if (isMalformedURLError(e))
    return new Response(null, {
      status: 400,
      statusText: "Bad Request",
    });
  switch (e.message) {
    case CONTROL_FLOW_ERROR.REDIRECT_TO_SIGN_IN:
      return createRedirect({
        redirectAdapter,
        baseUrl: clerkRequest.clerkUrl,
        signInUrl: requestState.signInUrl,
        signUpUrl: requestState.signUpUrl,
        publishableKey: getSafeEnv(context).pk,
        sessionStatus: requestState.toAuth()?.sessionStatus,
        isSatellite: requestState.isSatellite,
      }).redirectToSignIn({ returnBackUrl: e.returnBackUrl });
    default:
      throw e;
  }
};
export { clerkClient as a, clerkMiddleware as c };
