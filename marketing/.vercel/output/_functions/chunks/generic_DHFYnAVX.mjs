import {
  A as AstroError,
  b0 as NoImageMetadata,
  b1 as FailedToFetchRemoteImageDimensions,
  b2 as RemoteImageNotAllowed,
  b3 as removeQueryString,
  av as joinPaths,
  b4 as ExpectedImage,
  b5 as isRemotePath,
  b6 as LocalImageUsedWrongly,
  b7 as MissingImageDimension,
  b8 as UnsupportedImageFormat,
  b9 as IncompatibleDescriptorOptions,
  ba as UnsupportedImageConversion,
  bb as InvalidImageService,
  bc as ExpectedImageOptions,
  bd as ExpectedNotESMImage,
  be as ImageMissingAlt,
  u as maybeRenderHead,
  _ as addAttribute,
  I as renderTemplate,
  bf as FontFamilyNotFound,
  bg as unescapeHTML,
  bh as MissingGetFontFileRequestUrl,
} from "./sequence_9Z-GG-XK.mjs";
import {
  t as typeHandlers,
  a as types,
  i as isRemoteAllowed,
  s as spreadAttributes,
} from "./entrypoint_Ccz9lNni.mjs";
import { c as createComponent } from "./astro-component_Bvh79D0k.mjs";
import "clsx";
import * as mime from "mrmime";
import "piccolore";
function isESMImportedImage(src) {
  return typeof src === "object" || (typeof src === "function" && "src" in src);
}
function isRemoteImage(src) {
  return typeof src === "string";
}
async function resolveSrc(src) {
  if (typeof src === "object" && "then" in src) {
    const resource = await src;
    return resource.default ?? resource;
  }
  return src;
}
const firstBytes = /* @__PURE__ */ new Map([
  [0, "heif"],
  [56, "psd"],
  [66, "bmp"],
  [68, "dds"],
  [71, "gif"],
  [73, "tiff"],
  [77, "tiff"],
  [82, "webp"],
  [105, "icns"],
  [137, "png"],
  [255, "jpg"],
]);
function detector(input) {
  const byte = input[0];
  const type = firstBytes.get(byte);
  if (type && typeHandlers.get(type).validate(input)) {
    return type;
  }
  return types.find((imageType) => typeHandlers.get(imageType).validate(input));
}
function lookup(input) {
  const type = detector(input);
  if (typeof type !== "undefined") {
    const size = typeHandlers.get(type).calculate(input);
    if (size !== void 0) {
      size.type = size.type ?? type;
      return size;
    }
  }
  throw new TypeError("unsupported file type: " + type);
}
async function imageMetadata(data, src) {
  let result;
  try {
    result = lookup(data);
  } catch {
    throw new AstroError({
      ...NoImageMetadata,
      message: NoImageMetadata.message(src),
    });
  }
  if (result.height == null || result.width == null || !result.type) {
    throw new AstroError({
      ...NoImageMetadata,
      message: NoImageMetadata.message(src),
    });
  }
  const { width, height, type, orientation } = result;
  const isPortrait = (orientation || 0) >= 5;
  return {
    width: isPortrait ? height : width,
    height: isPortrait ? width : height,
    format: type,
    orientation,
  };
}
async function fetchWithRedirects(options) {
  const {
    url,
    headers,
    imageConfig: imageConfig2,
    fetchFn = globalThis.fetch,
    redirectLimit = 10,
    onMaxRedirectsExceeded = (_u) => new Error("Maximum redirect depth exceeded"),
    onMissingLocationHeader = (_s, _u) =>
      new Error(`Redirect response ${_s} missing Location header`),
    onDisallowedRedirect = (_current, _target) =>
      new Error(
        `The image at ${_current} redirected to ${_target}, which is not an allowed remote location.`,
      ),
  } = options;
  if (redirectLimit <= 0) {
    throw onMaxRedirectsExceeded(typeof url === "string" ? url : url.toString());
  }
  const urlString = typeof url === "string" ? url : url.toString();
  const req = new Request(url, { headers });
  const res = await fetchFn(req, { redirect: "manual" });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get("Location");
    if (!location) {
      throw onMissingLocationHeader(res.status, urlString);
    }
    const redirectUrl = new URL(location, urlString).toString();
    if (
      !isRemoteAllowed(redirectUrl, {
        domains: imageConfig2.domains ?? [],
        remotePatterns: imageConfig2.remotePatterns ?? [],
      })
    ) {
      throw onDisallowedRedirect(urlString, redirectUrl);
    }
    return fetchWithRedirects({
      url: redirectUrl,
      headers,
      imageConfig: imageConfig2,
      fetchFn,
      redirectLimit: redirectLimit - 1,
      onMaxRedirectsExceeded,
      onMissingLocationHeader,
      onDisallowedRedirect,
    });
  }
  return res;
}
async function inferRemoteSize(url, imageConfig2) {
  if (!URL.canParse(url)) {
    throw new AstroError({
      ...FailedToFetchRemoteImageDimensions,
      message: FailedToFetchRemoteImageDimensions.message(url),
    });
  }
  const allowlistConfig = imageConfig2
    ? {
        domains: imageConfig2.domains ?? [],
        remotePatterns: imageConfig2.remotePatterns ?? [],
      }
    : void 0;
  if (!allowlistConfig) {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new AstroError({
        ...FailedToFetchRemoteImageDimensions,
        message: FailedToFetchRemoteImageDimensions.message(url),
      });
    }
  }
  if (allowlistConfig && !isRemoteAllowed(url, allowlistConfig)) {
    throw new AstroError({
      ...RemoteImageNotAllowed,
      message: RemoteImageNotAllowed.message(url),
    });
  }
  let response;
  try {
    response = await fetchWithRedirects({
      url,
      onMaxRedirectsExceeded: (u) =>
        new AstroError({
          ...FailedToFetchRemoteImageDimensions,
          message: FailedToFetchRemoteImageDimensions.message(u),
        }),
      onMissingLocationHeader: (_status, u) =>
        new AstroError({
          ...FailedToFetchRemoteImageDimensions,
          message: FailedToFetchRemoteImageDimensions.message(u),
        }),
      imageConfig: imageConfig2 ?? {
        remotePatterns: [],
        domains: [],
      },
    });
  } catch (_err) {
    throw new AstroError({
      ...FailedToFetchRemoteImageDimensions,
      message: FailedToFetchRemoteImageDimensions.message(url),
    });
  }
  if (allowlistConfig && !isRemoteAllowed(response.url, allowlistConfig)) {
    throw new AstroError({
      ...RemoteImageNotAllowed,
      message: RemoteImageNotAllowed.message(url),
    });
  }
  if (!response.body || !response.ok) {
    throw new AstroError({
      ...FailedToFetchRemoteImageDimensions,
      message: FailedToFetchRemoteImageDimensions.message(url),
    });
  }
  const reader = response.body.getReader();
  let done, value;
  let accumulatedChunks = new Uint8Array();
  while (!done) {
    const readResult = await reader.read();
    done = readResult.done;
    if (done) break;
    if (readResult.value) {
      value = readResult.value;
      let tmp = new Uint8Array(accumulatedChunks.length + value.length);
      tmp.set(accumulatedChunks, 0);
      tmp.set(value, accumulatedChunks.length);
      accumulatedChunks = tmp;
      try {
        const dimensions = await imageMetadata(accumulatedChunks, url);
        if (dimensions) {
          await reader.cancel();
          return dimensions;
        }
      } catch {}
    }
  }
  throw new AstroError({
    ...NoImageMetadata,
    message: NoImageMetadata.message(url),
  });
}
const VALID_SUPPORTED_FORMATS = ["jpeg", "jpg", "png", "tiff", "webp", "gif", "svg", "avif"];
const DEFAULT_OUTPUT_FORMAT = "webp";
const DEFAULT_HASH_PROPS = [
  "src",
  "width",
  "height",
  "format",
  "quality",
  "fit",
  "position",
  "background",
];
const DEFAULT_RESOLUTIONS = [
  640,
  // older and lower-end phones
  750,
  // iPhone 6-8
  828,
  // iPhone XR/11
  960,
  // older horizontal phones
  1080,
  // iPhone 6-8 Plus
  1280,
  // 720p
  1668,
  // Various iPads
  1920,
  // 1080p
  2048,
  // QXGA
  2560,
  // WQXGA
  3200,
  // QHD+
  3840,
  // 4K
  4480,
  // 4.5K
  5120,
  // 5K
  6016,
  // 6K
];
const LIMITED_RESOLUTIONS = [
  640,
  // older and lower-end phones
  750,
  // iPhone 6-8
  828,
  // iPhone XR/11
  1080,
  // iPhone 6-8 Plus
  1280,
  // 720p
  1668,
  // Various iPads
  2048,
  // QXGA
  2560,
  // WQXGA
];
const getWidths = ({ width, layout, breakpoints = DEFAULT_RESOLUTIONS, originalWidth }) => {
  const smallerThanOriginal = (w) => !originalWidth || w <= originalWidth;
  if (layout === "full-width") {
    return breakpoints.filter(smallerThanOriginal);
  }
  if (!width) {
    return [];
  }
  const doubleWidth = width * 2;
  const maxSize = originalWidth ? Math.min(doubleWidth, originalWidth) : doubleWidth;
  if (layout === "fixed") {
    return originalWidth && width > originalWidth ? [originalWidth] : [width, maxSize];
  }
  if (layout === "constrained") {
    return [
      // Always include the image at 1x and 2x the specified width
      width,
      doubleWidth,
      ...breakpoints,
    ]
      .filter((w) => w <= maxSize)
      .sort((a, b) => a - b);
  }
  return [];
};
const getSizesAttribute = ({ width, layout }) => {
  if (!width || !layout) {
    return void 0;
  }
  switch (layout) {
    // If screen is wider than the max size then image width is the max size,
    // otherwise it's the width of the screen
    case "constrained":
      return `(min-width: ${width}px) ${width}px, 100vw`;
    // Image is always the same width, whatever the size of the screen
    case "fixed":
      return `${width}px`;
    // Image is always the width of the screen
    case "full-width":
      return `100vw`;
    case "none":
    default:
      return void 0;
  }
};
const DATA_PREFIX = "data:";
function inferSourceFormat(src) {
  if (src.startsWith(DATA_PREFIX)) {
    const sepIndex = src.indexOf(";");
    const commaIndex = src.indexOf(",");
    const mimeEnd =
      sepIndex === -1 ? commaIndex : commaIndex === -1 ? sepIndex : Math.min(sepIndex, commaIndex);
    if (mimeEnd === -1) return void 0;
    const mime2 = src.slice(DATA_PREFIX.length, mimeEnd);
    if (mime2 === "image/svg+xml") return "svg";
    const sub = mime2.split("/")[1];
    return sub || void 0;
  }
  try {
    const cleanSrc = removeQueryString(src).split("#")[0];
    const lastSlash = cleanSrc.lastIndexOf("/");
    const basename = lastSlash === -1 ? cleanSrc : cleanSrc.slice(lastSlash + 1);
    const lastDot = basename.lastIndexOf(".");
    if (lastDot === -1) return void 0;
    return basename.slice(lastDot + 1).toLowerCase();
  } catch {
    return void 0;
  }
}
function resolveDefaultOutputFormat(sourceFormat) {
  return sourceFormat === "svg" ? "svg" : DEFAULT_OUTPUT_FORMAT;
}
function isLocalService(service) {
  if (!service) {
    return false;
  }
  return "transform" in service;
}
function parseQuality(quality) {
  let result = Number.parseInt(quality);
  if (Number.isNaN(result)) {
    return quality;
  }
  return result;
}
const sortNumeric = (a, b) => a - b;
function verifyOptions(options) {
  if (!options.src || (!isRemoteImage(options.src) && !isESMImportedImage(options.src))) {
    throw new AstroError({
      ...ExpectedImage,
      message: ExpectedImage.message(
        JSON.stringify(options.src),
        typeof options.src,
        JSON.stringify(options, (_, v) => (v === void 0 ? null : v)),
      ),
    });
  }
  if (!isESMImportedImage(options.src)) {
    if (
      options.src.startsWith("/@fs/") ||
      (!isRemotePath(options.src) && !options.src.startsWith("/"))
    ) {
      throw new AstroError({
        ...LocalImageUsedWrongly,
        message: LocalImageUsedWrongly.message(options.src),
      });
    }
    let missingDimension;
    if (!options.width && !options.height) {
      missingDimension = "both";
    } else if (!options.width && options.height) {
      missingDimension = "width";
    } else if (options.width && !options.height) {
      missingDimension = "height";
    }
    if (missingDimension) {
      throw new AstroError({
        ...MissingImageDimension,
        message: MissingImageDimension.message(missingDimension, options.src),
      });
    }
  } else {
    if (!VALID_SUPPORTED_FORMATS.includes(options.src.format)) {
      throw new AstroError({
        ...UnsupportedImageFormat,
        message: UnsupportedImageFormat.message(
          options.src.format,
          options.src.src,
          VALID_SUPPORTED_FORMATS,
        ),
      });
    }
    if (options.widths && options.densities) {
      throw new AstroError(IncompatibleDescriptorOptions);
    }
    if (options.src.format !== "svg" && options.format === "svg") {
      throw new AstroError(UnsupportedImageConversion);
    }
  }
}
const baseService = {
  validateOptions(options) {
    verifyOptions(options);
    if (!options.format) {
      if (isESMImportedImage(options.src)) {
        options.format = resolveDefaultOutputFormat(options.src.format);
      } else {
        const inferred = inferSourceFormat(options.src);
        if (inferred) options.format = resolveDefaultOutputFormat(inferred);
      }
    }
    if (options.width) options.width = Math.round(options.width);
    if (options.height) options.height = Math.round(options.height);
    if (options.layout) {
      delete options.layout;
    }
    if (options.fit === "none") {
      delete options.fit;
    }
    return options;
  },
  getHTMLAttributes(options) {
    const { targetWidth, targetHeight } = getTargetDimensions(options);
    const {
      src,
      width,
      height,
      format,
      quality,
      densities,
      widths,
      formats,
      layout,
      priority,
      fit,
      position,
      background,
      ...attributes
    } = options;
    return {
      ...attributes,
      width: targetWidth,
      height: targetHeight,
      loading: attributes.loading ?? "lazy",
      decoding: attributes.decoding ?? "async",
    };
  },
  getSrcSet(options) {
    const { targetWidth, targetHeight } = getTargetDimensions(options);
    const aspectRatio = targetWidth / targetHeight;
    const { widths, densities } = options;
    const targetFormat = options.format;
    let transformedWidths = (widths ?? []).sort(sortNumeric);
    let imageWidth = options.width;
    let maxWidth = Number.POSITIVE_INFINITY;
    if (isESMImportedImage(options.src)) {
      imageWidth = options.src.width;
      maxWidth = imageWidth;
      if (transformedWidths.length > 0 && transformedWidths.at(-1) > maxWidth) {
        transformedWidths = transformedWidths.filter((width) => width <= maxWidth);
        transformedWidths.push(maxWidth);
      }
    }
    transformedWidths = Array.from(new Set(transformedWidths));
    const {
      width: transformWidth,
      height: transformHeight,
      ...transformWithoutDimensions
    } = options;
    let allWidths = [];
    if (densities) {
      const densityValues = densities.map((density) => {
        if (typeof density === "number") {
          return density;
        } else {
          return Number.parseFloat(density);
        }
      });
      const densityWidths = densityValues
        .sort(sortNumeric)
        .map((density) => Math.round(targetWidth * density));
      allWidths = densityWidths.map((width, index) => ({
        width,
        descriptor: `${densityValues[index]}x`,
      }));
    } else if (transformedWidths.length > 0) {
      allWidths = transformedWidths.map((width) => ({
        width,
        descriptor: `${width}w`,
      }));
    }
    return allWidths.map(({ width, descriptor }) => {
      const height = Math.round(width / aspectRatio);
      const transform = { ...transformWithoutDimensions, width, height };
      return {
        transform,
        descriptor,
        attributes: targetFormat ? { type: `image/${targetFormat}` } : {},
      };
    });
  },
  getURL(options, imageConfig2) {
    const searchParams = new URLSearchParams();
    if (isESMImportedImage(options.src)) {
      searchParams.append("href", options.src.src);
    } else if (isRemoteAllowed(options.src, imageConfig2)) {
      searchParams.append("href", options.src);
    } else {
      return options.src;
    }
    const params = {
      w: "width",
      h: "height",
      q: "quality",
      f: "format",
      fit: "fit",
      position: "position",
      background: "background",
    };
    Object.entries(params).forEach(([param, key]) => {
      options[key] && searchParams.append(param, options[key].toString());
    });
    const imageEndpoint = joinPaths("/", imageConfig2.endpoint.route);
    let url = `${imageEndpoint}?${searchParams}`;
    if (imageConfig2.assetQueryParams) {
      const assetQueryString = imageConfig2.assetQueryParams.toString();
      if (assetQueryString) {
        url += "&" + assetQueryString;
      }
    }
    return url;
  },
  parseURL(url) {
    const params = url.searchParams;
    if (!params.has("href")) {
      return void 0;
    }
    const transform = {
      src: params.get("href"),
      width: params.has("w") ? Number.parseInt(params.get("w")) : void 0,
      height: params.has("h") ? Number.parseInt(params.get("h")) : void 0,
      format: params.has("f") ? params.get("f") : void 0,
      quality: params.get("q"),
      fit: params.get("fit"),
      position: params.get("position") ?? void 0,
      background: params.get("background") ?? void 0,
    };
    return transform;
  },
  getRemoteSize(url, imageConfig2) {
    return inferRemoteSize(url, imageConfig2);
  },
};
function getTargetDimensions(options) {
  let targetWidth = options.width;
  let targetHeight = options.height;
  if (isESMImportedImage(options.src)) {
    const aspectRatio = options.src.width / options.src.height;
    if (targetHeight && !targetWidth) {
      targetWidth = Math.round(targetHeight * aspectRatio);
    } else if (targetWidth && !targetHeight) {
      targetHeight = Math.round(targetWidth / aspectRatio);
    } else if (!targetWidth && !targetHeight) {
      targetWidth = options.src.width;
      targetHeight = options.src.height;
    }
  }
  return {
    targetWidth,
    targetHeight,
  };
}
function isImageMetadata(src) {
  return src.fsPath && !("fsPath" in src);
}
const PLACEHOLDER_BASE = "astro://placeholder";
function createPlaceholderURL(pathOrUrl) {
  return new URL(pathOrUrl, PLACEHOLDER_BASE);
}
function stringifyPlaceholderURL(url) {
  return url.href.replace(PLACEHOLDER_BASE, "");
}
const cssFitValues = ["fill", "contain", "cover", "scale-down"];
async function getConfiguredImageService() {
  if (!globalThis?.astroAsset?.imageService) {
    const { default: service } = await import(
      // @ts-expect-error
      "./sharp_zgvRmSdi.mjs"
    ).catch((e) => {
      const error = new AstroError(InvalidImageService);
      error.cause = e;
      throw error;
    });
    if (!globalThis.astroAsset) globalThis.astroAsset = {};
    globalThis.astroAsset.imageService = service;
    return service;
  }
  return globalThis.astroAsset.imageService;
}
async function getImage$1(options, imageConfig2) {
  if (!options || typeof options !== "object") {
    throw new AstroError({
      ...ExpectedImageOptions,
      message: ExpectedImageOptions.message(JSON.stringify(options)),
    });
  }
  if (typeof options.src === "undefined") {
    throw new AstroError({
      ...ExpectedImage,
      message: ExpectedImage.message(options.src, "undefined", JSON.stringify(options)),
    });
  }
  if (isImageMetadata(options)) {
    throw new AstroError(ExpectedNotESMImage);
  }
  const service = await getConfiguredImageService();
  const resolvedOptions = {
    ...options,
    src: await resolveSrc(options.src),
  };
  let originalWidth;
  let originalHeight;
  if (resolvedOptions.inferSize) {
    delete resolvedOptions.inferSize;
    if (isRemoteImage(resolvedOptions.src) && isRemotePath(resolvedOptions.src)) {
      if (!isRemoteAllowed(resolvedOptions.src, imageConfig2)) {
        throw new AstroError({
          ...RemoteImageNotAllowed,
          message: RemoteImageNotAllowed.message(resolvedOptions.src),
        });
      }
      const getRemoteSize = (url) =>
        service.getRemoteSize?.(url, imageConfig2) ?? inferRemoteSize(url, imageConfig2);
      const result = await getRemoteSize(resolvedOptions.src);
      resolvedOptions.width ??= result.width;
      resolvedOptions.height ??= result.height;
      if (result.format) {
        resolvedOptions.format ??= resolveDefaultOutputFormat(result.format);
      }
      originalWidth = result.width;
      originalHeight = result.height;
    }
  }
  const originalFilePath = isESMImportedImage(resolvedOptions.src)
    ? resolvedOptions.src.fsPath
    : void 0;
  const clonedSrc = isESMImportedImage(resolvedOptions.src)
    ? // @ts-expect-error - clone is a private, hidden prop
      (resolvedOptions.src.clone ?? resolvedOptions.src)
    : resolvedOptions.src;
  if (isESMImportedImage(clonedSrc)) {
    originalWidth = clonedSrc.width;
    originalHeight = clonedSrc.height;
  }
  if (originalWidth && originalHeight) {
    const aspectRatio = originalWidth / originalHeight;
    if (resolvedOptions.height && !resolvedOptions.width) {
      resolvedOptions.width = Math.round(resolvedOptions.height * aspectRatio);
    } else if (resolvedOptions.width && !resolvedOptions.height) {
      resolvedOptions.height = Math.round(resolvedOptions.width / aspectRatio);
    } else if (!resolvedOptions.width && !resolvedOptions.height) {
      resolvedOptions.width = originalWidth;
      resolvedOptions.height = originalHeight;
    }
  }
  resolvedOptions.src = clonedSrc;
  const layout = options.layout ?? imageConfig2.layout ?? "none";
  if (resolvedOptions.priority) {
    resolvedOptions.loading ??= "eager";
    resolvedOptions.decoding ??= "sync";
    resolvedOptions.fetchpriority ??= "high";
    delete resolvedOptions.priority;
  } else {
    resolvedOptions.loading ??= "lazy";
    resolvedOptions.decoding ??= "async";
    resolvedOptions.fetchpriority ??= void 0;
  }
  if (layout !== "none") {
    resolvedOptions.widths ||= getWidths({
      width: resolvedOptions.width,
      layout,
      originalWidth,
      breakpoints: imageConfig2.breakpoints?.length
        ? imageConfig2.breakpoints
        : isLocalService(service)
          ? LIMITED_RESOLUTIONS
          : DEFAULT_RESOLUTIONS,
    });
    resolvedOptions.sizes ||= getSizesAttribute({ width: resolvedOptions.width, layout });
    delete resolvedOptions.densities;
    resolvedOptions["data-astro-image"] = layout;
    if (resolvedOptions.fit && cssFitValues.includes(resolvedOptions.fit)) {
      resolvedOptions["data-astro-image-fit"] = resolvedOptions.fit;
    }
    const currentPosition = resolvedOptions.position || "center";
    resolvedOptions["data-astro-image-pos"] = currentPosition.replace(/\s+/g, "-");
  }
  const validatedOptions = service.validateOptions
    ? await service.validateOptions(resolvedOptions, imageConfig2)
    : resolvedOptions;
  validatedOptions.format ??= await peekRemoteFormatForStaticEmit(
    validatedOptions,
    imageConfig2,
    service,
  );
  const srcSetTransforms = service.getSrcSet
    ? await service.getSrcSet(validatedOptions, imageConfig2)
    : [];
  const lazyImageURLFactory = (getValue) => {
    let cached = null;
    return () => (cached ??= getValue());
  };
  const initialImageURL = await service.getURL(validatedOptions, imageConfig2);
  let lazyImageURL = lazyImageURLFactory(() => initialImageURL);
  const matchesValidatedTransform = (transform) =>
    transform.width === validatedOptions.width &&
    transform.height === validatedOptions.height &&
    transform.format === validatedOptions.format;
  let srcSets = await Promise.all(
    srcSetTransforms.map(async (srcSet) => {
      return {
        transform: srcSet.transform,
        url: matchesValidatedTransform(srcSet.transform)
          ? initialImageURL
          : await service.getURL(srcSet.transform, imageConfig2),
        descriptor: srcSet.descriptor,
        attributes: srcSet.attributes,
      };
    }),
  );
  if (
    isLocalService(service) &&
    globalThis.astroAsset.addStaticImage &&
    !(isRemoteImage(validatedOptions.src) && initialImageURL === validatedOptions.src)
  ) {
    const propsToHash = service.propertiesToHash ?? DEFAULT_HASH_PROPS;
    lazyImageURL = lazyImageURLFactory(() =>
      globalThis.astroAsset.addStaticImage(validatedOptions, propsToHash, originalFilePath),
    );
    srcSets = srcSetTransforms.map((srcSet) => {
      return {
        transform: srcSet.transform,
        url: matchesValidatedTransform(srcSet.transform)
          ? lazyImageURL()
          : globalThis.astroAsset.addStaticImage(srcSet.transform, propsToHash, originalFilePath),
        descriptor: srcSet.descriptor,
        attributes: srcSet.attributes,
      };
    });
  } else if (imageConfig2.assetQueryParams) {
    const imageURLObj = createPlaceholderURL(initialImageURL);
    imageConfig2.assetQueryParams.forEach((value, key) => {
      imageURLObj.searchParams.set(key, value);
    });
    lazyImageURL = lazyImageURLFactory(() => stringifyPlaceholderURL(imageURLObj));
    srcSets = srcSets.map((srcSet) => {
      const urlObj = createPlaceholderURL(srcSet.url);
      imageConfig2.assetQueryParams.forEach((value, key) => {
        urlObj.searchParams.set(key, value);
      });
      return {
        ...srcSet,
        url: stringifyPlaceholderURL(urlObj),
      };
    });
  }
  return {
    rawOptions: resolvedOptions,
    options: validatedOptions,
    get src() {
      return lazyImageURL();
    },
    srcSet: {
      values: srcSets,
      attribute: srcSets.map((srcSet) => `${srcSet.url} ${srcSet.descriptor}`).join(", "),
    },
    attributes:
      service.getHTMLAttributes !== void 0
        ? await service.getHTMLAttributes(validatedOptions, imageConfig2)
        : {},
  };
}
async function peekRemoteFormatForStaticEmit(options, imageConfig2, service) {
  if (
    !isRemoteImage(options.src) ||
    !isRemoteAllowed(options.src, imageConfig2) ||
    !globalThis.astroAsset?.addStaticImage ||
    !isLocalService(service) ||
    !service.getRemoteSize
  ) {
    return void 0;
  }
  try {
    const probed = await service.getRemoteSize(options.src, imageConfig2);
    return resolveDefaultOutputFormat(probed.format);
  } catch {
    return void 0;
  }
}
Function.prototype.toString.call(Object);
const $$Image = createComponent(
  async ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$Image;
    const props = Astro2.props;
    if (props.alt === void 0 || props.alt === null) {
      throw new AstroError(ImageMissingAlt);
    }
    if (typeof props.width === "string") {
      props.width = Number.parseInt(props.width);
    }
    if (typeof props.height === "string") {
      props.height = Number.parseInt(props.height);
    }
    const layout = props.layout ?? imageConfig.layout ?? "none";
    if (layout !== "none") {
      props.layout ??= imageConfig.layout;
      props.fit ??= imageConfig.objectFit ?? "cover";
      props.position ??= imageConfig.objectPosition ?? "center";
    } else if (imageConfig.objectFit || imageConfig.objectPosition) {
      props.fit ??= imageConfig.objectFit;
      props.position ??= imageConfig.objectPosition;
    }
    const image = await getImage(props);
    const additionalAttributes = {};
    if (image.srcSet.values.length > 0) {
      additionalAttributes.srcset = image.srcSet.attribute;
    }
    const { class: className, ...attributes } = { ...additionalAttributes, ...image.attributes };
    return renderTemplate`${maybeRenderHead()}<img${addAttribute(image.src, "src")}${spreadAttributes(attributes)}${addAttribute(className, "class")}>`;
  },
  "/Users/harshithpasupuleti/code/omni/marketing/node_modules/astro/components/Image.astro",
  void 0,
);
const $$Picture = createComponent(
  async ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$Picture;
    const defaultFormats = ["webp"];
    const defaultFallbackFormat = "png";
    const specialFormatsFallback = ["gif", "svg", "jpg", "jpeg"];
    const {
      formats = defaultFormats,
      pictureAttributes = {},
      fallbackFormat,
      ...props
    } = Astro2.props;
    if (props.alt === void 0 || props.alt === null) {
      throw new AstroError(ImageMissingAlt);
    }
    const scopedStyleClass = props.class?.match(/\bastro-\w{8}\b/)?.[0];
    if (scopedStyleClass) {
      if (pictureAttributes.class) {
        pictureAttributes.class = `${pictureAttributes.class} ${scopedStyleClass}`;
      } else {
        pictureAttributes.class = scopedStyleClass;
      }
    }
    const layout = props.layout ?? imageConfig.layout ?? "none";
    const useResponsive = layout !== "none";
    if (useResponsive) {
      props.layout ??= imageConfig.layout;
      props.fit ??= imageConfig.objectFit ?? "cover";
      props.position ??= imageConfig.objectPosition ?? "center";
    } else if (imageConfig.objectFit || imageConfig.objectPosition) {
      props.fit ??= imageConfig.objectFit;
      props.position ??= imageConfig.objectPosition;
    }
    for (const key in props) {
      if (key.startsWith("data-astro-cid")) {
        pictureAttributes[key] = props[key];
      }
    }
    const originalSrc = await resolveSrc(props.src);
    const optimizedImages = await Promise.all(
      formats.map(
        async (format) =>
          await getImage({
            ...props,
            src: originalSrc,
            format,
            widths: props.widths,
            densities: props.densities,
          }),
      ),
    );
    const clonedSrc = isESMImportedImage(originalSrc)
      ? // @ts-expect-error - clone is a private, hidden prop
        (originalSrc.clone ?? originalSrc)
      : originalSrc;
    let resultFallbackFormat = fallbackFormat ?? defaultFallbackFormat;
    if (
      !fallbackFormat &&
      isESMImportedImage(clonedSrc) &&
      specialFormatsFallback.includes(clonedSrc.format)
    ) {
      resultFallbackFormat = clonedSrc.format;
    }
    const fallbackImage = await getImage({
      ...props,
      format: resultFallbackFormat,
      widths: props.widths,
      densities: props.densities,
    });
    const imgAdditionalAttributes = {};
    const sourceAdditionalAttributes = {};
    if (props.sizes) {
      sourceAdditionalAttributes.sizes = props.sizes;
    }
    if (fallbackImage.srcSet.values.length > 0) {
      imgAdditionalAttributes.srcset = fallbackImage.srcSet.attribute;
    }
    const { class: className, ...attributes } = {
      ...imgAdditionalAttributes,
      ...fallbackImage.attributes,
    };
    return renderTemplate`${maybeRenderHead()}<picture${spreadAttributes(pictureAttributes)}> ${Object.entries(
      optimizedImages,
    ).map(([_, image]) => {
      const srcsetAttribute =
        props.densities || (!props.densities && !props.widths && !useResponsive)
          ? `${image.src}${image.srcSet.values.length > 0 ? ", " + image.srcSet.attribute : ""}`
          : image.srcSet.attribute;
      return renderTemplate`<source${addAttribute(srcsetAttribute, "srcset")}${addAttribute(mime.lookup(image.options.format ?? image.src) ?? `image/${image.options.format}`, "type")}${spreadAttributes(sourceAdditionalAttributes)}>`;
    })}  <img${addAttribute(fallbackImage.src, "src")}${spreadAttributes(attributes)}${addAttribute(className, "class")}> </picture>`;
  },
  "/Users/harshithpasupuleti/code/omni/marketing/node_modules/astro/components/Picture.astro",
  void 0,
);
const componentDataByCssVariable = /* @__PURE__ */ new Map([]);
function filterPreloads(data, preload) {
  if (!preload) {
    return null;
  }
  if (preload === true) {
    return data;
  }
  return data.filter(({ weight, style, subset }) =>
    preload.some((p) => {
      if (p.weight !== void 0 && weight !== void 0 && !checkWeight(p.weight.toString(), weight)) {
        return false;
      }
      if (p.style !== void 0 && p.style !== style) {
        return false;
      }
      if (p.subset !== void 0 && p.subset !== subset) {
        return false;
      }
      return true;
    }),
  );
}
function checkWeight(input, target) {
  const trimmedInput = input.trim();
  if (trimmedInput.includes(" ")) {
    return trimmedInput === target;
  }
  if (target.includes(" ")) {
    const [a, b] = target.split(" ");
    const parsedInput = Number.parseInt(input);
    return parsedInput >= Number.parseInt(a) && parsedInput <= Number.parseInt(b);
  }
  return input === target;
}
const $$Font = createComponent(
  ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$Font;
    const { cssVariable, preload = false } = Astro2.props;
    const data = componentDataByCssVariable.get(cssVariable);
    if (!data) {
      throw new AstroError({
        ...FontFamilyNotFound,
        message: FontFamilyNotFound.message(cssVariable),
      });
    }
    const filteredPreloadData = filterPreloads(data.preloads, preload);
    return renderTemplate`<style>${unescapeHTML(data.css)}</style>${filteredPreloadData?.map(({ url, type }) => renderTemplate`<link rel="preload"${addAttribute(url, "href")} as="font"${addAttribute(`font/${type}`, "type")} crossorigin>`)}`;
  },
  "/Users/harshithpasupuleti/code/omni/marketing/node_modules/astro/components/Font.astro",
  void 0,
);
class SsrRuntimeFontFileUrlResolver {
  #urls;
  constructor({ urls }) {
    this.#urls = urls;
  }
  resolve(url, requestUrl) {
    if (!this.#urls.has(url)) {
      return null;
    }
    if (!url.startsWith("/")) {
      return url;
    }
    if (!requestUrl) {
      throw new AstroError(MissingGetFontFileRequestUrl);
    }
    return `${requestUrl.origin}${url}`;
  }
}
new SsrRuntimeFontFileUrlResolver({
  urls: /* @__PURE__ */ new Set([]),
});
const assetQueryParams = void 0;
const imageConfig = {
  endpoint: { route: "/_image" },
  service: { entrypoint: "astro/assets/services/sharp", config: {} },
  dangerouslyProcessSVG: false,
  domains: [],
  remotePatterns: [],
  responsiveStyles: false,
};
Object.defineProperty(imageConfig, "assetQueryParams", {
  value: assetQueryParams,
  enumerable: false,
  configurable: true,
});
const getImage = async (options) => await getImage$1(options, imageConfig);
const fnv1a52 = (str) => {
  const len = str.length;
  let i = 0,
    t0 = 0,
    v0 = 8997,
    t1 = 0,
    v1 = 33826,
    t2 = 0,
    v2 = 40164,
    t3 = 0,
    v3 = 52210;
  while (i < len) {
    v0 ^= str.charCodeAt(i++);
    t0 = v0 * 435;
    t1 = v1 * 435;
    t2 = v2 * 435;
    t3 = v3 * 435;
    t2 += v0 << 8;
    t3 += v1 << 8;
    t1 += t0 >>> 16;
    v0 = t0 & 65535;
    t2 += t1 >>> 16;
    v1 = t1 & 65535;
    v3 = (t3 + (t2 >>> 16)) & 65535;
    v2 = t2 & 65535;
  }
  return (v3 & 15) * 281474976710656 + v2 * 4294967296 + v1 * 65536 + (v0 ^ (v3 >> 4));
};
const etag = (payload, weak = false) => {
  const prefix = weak ? 'W/"' : '"';
  return prefix + fnv1a52(payload).toString(36) + payload.length.toString(36) + '"';
};
async function loadImage(src, headers, imageConfig2, isRemote, fetchFn) {
  try {
    const res = await fetchWithRedirects({ url: src, headers, imageConfig: imageConfig2, fetchFn });
    if (isRemote && !isRemoteAllowed(res.url, imageConfig2)) {
      return void 0;
    }
    if (!res.ok) {
      return void 0;
    }
    return await res.arrayBuffer();
  } catch {
    return void 0;
  }
}
const GET = async ({ request }) => {
  try {
    const imageService = await getConfiguredImageService();
    if (!("transform" in imageService)) {
      throw new Error("Configured image service is not a local service");
    }
    const url = new URL(request.url);
    const transform = await imageService.parseURL(url, imageConfig);
    if (!transform?.src) {
      throw new Error("Incorrect transform returned by `parseURL`");
    }
    let inputBuffer = void 0;
    const isRemoteImage2 = isRemotePath(transform.src);
    if (isRemoteImage2 && isRemoteAllowed(transform.src, imageConfig) === false) {
      return new Response("Forbidden", { status: 403 });
    }
    const sourceUrl = new URL(transform.src, url.origin);
    if (!isRemoteImage2 && sourceUrl.origin !== url.origin) {
      return new Response("Forbidden", { status: 403 });
    }
    inputBuffer = await loadImage(
      sourceUrl,
      isRemoteImage2 ? new Headers() : request.headers,
      imageConfig,
      isRemoteImage2,
    );
    if (!inputBuffer) {
      return new Response("Not Found", { status: 404 });
    }
    const { data, format } = await imageService.transform(
      new Uint8Array(inputBuffer),
      transform,
      imageConfig,
    );
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": mime.lookup(format) ?? `image/${format}`,
        "Cache-Control": "public, max-age=31536000",
        ETag: etag(data.toString()),
        Date: /* @__PURE__ */ new Date().toUTCString(),
      },
    });
  } catch (err) {
    console.error("Could not process image request:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
};
const _page = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      GET,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
const page = () => _page;
const generic___js = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      page,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
export {
  baseService as b,
  detector as d,
  generic___js as g,
  parseQuality as p,
  resolveDefaultOutputFormat as r,
};
