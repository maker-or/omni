import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function createCustomResolver(resolveCache: Map<string, string | null>, baseDir: string) {
  return function customResolver(
    source: string,
    _importer?: string,
    _options?: any,
  ): string | null {
    const cacheKey = source;
    if (resolveCache.has(cacheKey)) {
      return resolveCache.get(cacheKey) || null;
    }

    const srcPath = resolve(baseDir, "src", source);
    const extensions = [".tsx", ".ts", ".jsx", ".js", ".css"];

    for (const ext of ["", ...extensions]) {
      const fullPath = srcPath + ext;
      if (existsSync(fullPath)) {
        resolveCache.set(cacheKey, fullPath);
        return fullPath;
      }
    }

    const atPath = resolve(baseDir, "@", source);
    for (const ext of ["", ...extensions]) {
      const fullPath = atPath + ext;
      if (existsSync(fullPath)) {
        resolveCache.set(cacheKey, fullPath);
        return fullPath;
      }
    }

    resolveCache.set(cacheKey, null);
    return null;
  };
}
