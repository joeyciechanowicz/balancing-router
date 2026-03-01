import type { RouteHandler, RouteMatch } from '../index';
import { buildRouteIrFromPattern } from './ir';
import { generateVariantMatcher, type GeneratedMatcher } from './codegen';
import type { RouteIrVariant } from './types';

interface CompiledVariant {
  segments: CompiledSegment[];
}

type CompiledSegment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string; regex?: RegExp }
  | { kind: 'wildcard'; name: string };

interface CompiledVariantMatcher {
  generated?: GeneratedMatcher;
  interpreted: CompiledVariant;
}

interface CompiledRoute {
  method: string;
  variants: CompiledVariantMatcher[];
  handler: RouteHandler;
  store?: any;
  order: number;
  minDepth: number;
  maxDepth: number;
}

interface GeneratedRouterOptions {
  mode?: 'generated' | 'interpreted';
}

const methodCache = Object.create(null) as Record<string, string>;
const EMPTY_PARAMS = Object.create(null) as Record<string, string>;

export class GeneratedRouter {
  private readonly _routes: CompiledRoute[] = [];
  private _order = 0;
  private readonly _mode: 'generated' | 'interpreted';
  private _cacheLimit = 1_000_000;
  private _cacheGET: Record<string, RouteMatch | null> = Object.create(null);
  private _cacheOther = new Map<string, Record<string, RouteMatch | null>>();
  private _cacheMethods: string[] = new Array(this._cacheLimit);
  private _cachePaths: string[] = new Array(this._cacheLimit);
  private _cacheSize = 0;
  private _cacheIndex = 0;

  constructor(options?: GeneratedRouterOptions) {
    this._mode = options?.mode ?? 'generated';
  }

  on(method: string | string[], path: string, handler: RouteHandler, store?: any): this {
    const methods = Array.isArray(method) ? method : [method];
    const ir = buildRouteIrFromPattern(path);
    const variants = ir.variants.map((variant) => compileVariant(variant, this._mode === 'generated'));
    const bounds = computeDepthBounds(variants);
    for (const item of methods) {
      this._routes.push({
        method: normalizeMethod(item),
        variants,
        handler,
        store,
        order: this._order++,
        minDepth: bounds.minDepth,
        maxDepth: bounds.maxDepth,
      });
    }
    this._clearCache();
    return this;
  }

  find(method: string, path: string): RouteMatch | null {
    if (method === 'GET') {
      return this._findGET(path);
    }
    const methodKey = normalizeMethod(method);
    return this._findWithMethod(methodKey, path);
  }

  private _findGET(path: string): RouteMatch | null {
    const pathStr = normalizePath(path);
    const cached = this._cacheGET[pathStr];
    if (cached !== undefined) return cached;
    const resolved = this._resolveMatch('GET', pathStr);
    this._cacheSetGET(pathStr, resolved);
    return resolved;
  }

  private _findWithMethod(methodKey: string, path: string): RouteMatch | null {
    const pathStr = normalizePath(path);
    const cached = this._cacheGet(methodKey, pathStr);
    if (cached !== undefined) return cached;
    const resolved = this._resolveMatch(methodKey, pathStr);
    this._cacheSet(methodKey, pathStr, resolved);
    return resolved;
  }

  private _resolveMatch(methodKey: string, pathStr: string): RouteMatch | null {
    const segments = splitPath(pathStr);
    const depth = segments.length;

    let wildcardMatch: RouteMatch | null = null;
    let wildcardOrder = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this._routes.length; i += 1) {
      const route = this._routes[i];
      if (depth < route.minDepth) continue;
      if (route.maxDepth >= 0 && depth > route.maxDepth) continue;
      const params = this._matchRoute(route.variants, segments);
      if (!params) continue;

      if (route.method === methodKey) {
        return { handler: route.handler, params, store: route.store };
      }

      if (route.method === '*' && route.order < wildcardOrder) {
        wildcardMatch = { handler: route.handler, params, store: route.store };
        wildcardOrder = route.order;
      }
    }

    return wildcardMatch;
  }

  private _matchRoute(variants: CompiledVariantMatcher[], segments: string[]): Record<string, string> | null {
    for (let i = 0; i < variants.length; i += 1) {
      const variant = variants[i];
      if (variant.generated) {
        const params = variant.generated(segments);
        if (params) return params;
      } else {
        const params = matchInterpretedVariant(variant.interpreted, segments);
        if (params) return params;
      }
    }
    return null;
  }

  private _cacheGet(method: string, path: string): RouteMatch | null | undefined {
    if (this._cacheLimit <= 0) return undefined;
    if (method === 'GET') return this._cacheGET[path];
    const methodMap = this._cacheOther.get(method);
    if (!methodMap) return undefined;
    return methodMap[path];
  }

  private _cacheSet(method: string, path: string, match: RouteMatch | null): void {
    if (this._cacheLimit <= 0) return;
    let methodMap: Record<string, RouteMatch | null>;
    if (method === 'GET') {
      methodMap = this._cacheGET;
    } else {
      methodMap = this._cacheOther.get(method) ?? Object.create(null);
      this._cacheOther.set(method, methodMap);
    }

    if (methodMap[path] !== undefined) {
      methodMap[path] = match;
      return;
    }

    if (this._cacheSize < this._cacheLimit) {
      this._cacheMethods[this._cacheSize] = method;
      this._cachePaths[this._cacheSize] = path;
      this._cacheSize += 1;
      methodMap[path] = match;
      return;
    }

    const evictIndex = this._cacheIndex;
    const evictMethod = this._cacheMethods[evictIndex];
    const evictPath = this._cachePaths[evictIndex];
    if (evictMethod === 'GET') {
      delete this._cacheGET[evictPath];
    } else {
      const evictMap = this._cacheOther.get(evictMethod);
      if (evictMap) delete evictMap[evictPath];
    }

    this._cacheMethods[evictIndex] = method;
    this._cachePaths[evictIndex] = path;
    methodMap[path] = match;
    this._cacheIndex = (evictIndex + 1) % this._cacheLimit;
  }

  private _cacheSetGET(path: string, match: RouteMatch | null): void {
    if (this._cacheLimit <= 0) return;
    if (this._cacheGET[path] !== undefined) {
      this._cacheGET[path] = match;
      return;
    }

    if (this._cacheSize < this._cacheLimit) {
      this._cacheMethods[this._cacheSize] = 'GET';
      this._cachePaths[this._cacheSize] = path;
      this._cacheSize += 1;
      this._cacheGET[path] = match;
      return;
    }

    const evictIndex = this._cacheIndex;
    const evictMethod = this._cacheMethods[evictIndex];
    const evictPath = this._cachePaths[evictIndex];
    if (evictMethod === 'GET') {
      delete this._cacheGET[evictPath];
    } else {
      const evictMap = this._cacheOther.get(evictMethod);
      if (evictMap) delete evictMap[evictPath];
    }

    this._cacheMethods[evictIndex] = 'GET';
    this._cachePaths[evictIndex] = path;
    this._cacheGET[path] = match;
    this._cacheIndex = (evictIndex + 1) % this._cacheLimit;
  }

  private _clearCache(): void {
    this._cacheGET = Object.create(null);
    this._cacheOther = new Map();
    this._cacheMethods = new Array(this._cacheLimit);
    this._cachePaths = new Array(this._cacheLimit);
    this._cacheSize = 0;
    this._cacheIndex = 0;
  }
}

export function createGeneratedRouter(options?: GeneratedRouterOptions): GeneratedRouter {
  return new GeneratedRouter(options);
}

function compileVariant(variant: RouteIrVariant, useCodegen: boolean): CompiledVariantMatcher {
  const interpreted = compileInterpretedVariant(variant);
  if (!useCodegen) {
    return { interpreted };
  }
  try {
    const generated = generateVariantMatcher(variant);
    return { generated, interpreted };
  } catch {
    return { interpreted };
  }
}

function compileInterpretedVariant(variant: RouteIrVariant): CompiledVariant {
  const segments: CompiledSegment[] = variant.segments.map((segment) => {
    switch (segment.kind) {
      case 'static':
        return { kind: 'static', value: segment.value };
      case 'param':
        return {
          kind: 'param',
          name: segment.name,
          regex: segment.pattern ? new RegExp(`^${segment.pattern}$`) : undefined,
        };
      case 'wildcard':
        return { kind: 'wildcard', name: segment.name };
      default: {
        const exhausted: never = segment;
        throw new Error(`Unhandled segment kind: ${String(exhausted)}`);
      }
    }
  });
  return { segments };
}

function matchInterpretedVariant(variant: CompiledVariant, pathSegments: string[]): Record<string, string> | null {
  const routeSegments = variant.segments;
  let params: Record<string, string> | null = null;
  let pathIndex = 0;

  for (let i = 0; i < routeSegments.length; i += 1) {
    const segment = routeSegments[i];
    if (segment.kind === 'wildcard') {
      const rest = pathIndex < pathSegments.length ? pathSegments.slice(pathIndex).join('/') : '';
      if (!params) params = Object.create(null) as Record<string, string>;
      params[segment.name] = rest;
      pathIndex = pathSegments.length;
      continue;
    }
    if (pathIndex >= pathSegments.length) return null;
    const value = pathSegments[pathIndex];
    if (segment.kind === 'static') {
      if (value !== segment.value) return null;
      pathIndex += 1;
      continue;
    }
    if (segment.regex && !segment.regex.test(value)) return null;
    if (!params) params = Object.create(null) as Record<string, string>;
    params[segment.name] = value;
    pathIndex += 1;
  }

  if (pathIndex !== pathSegments.length) return null;
  return params ?? EMPTY_PARAMS;
}

function computeDepthBounds(variants: CompiledVariantMatcher[]): { minDepth: number; maxDepth: number } {
  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = 0;
  let hasOpenMax = false;

  for (let i = 0; i < variants.length; i += 1) {
    const segments = variants[i].interpreted.segments;
    let wildcardIndex = -1;
    for (let s = 0; s < segments.length; s += 1) {
      if (segments[s].kind === 'wildcard') {
        wildcardIndex = s;
        break;
      }
    }
    const variantMin = wildcardIndex >= 0 ? wildcardIndex : segments.length;
    const variantMax = wildcardIndex >= 0 ? -1 : segments.length;
    if (variantMin < minDepth) minDepth = variantMin;
    if (variantMax < 0) {
      hasOpenMax = true;
    } else if (variantMax > maxDepth) {
      maxDepth = variantMax;
    }
  }

  if (!Number.isFinite(minDepth)) minDepth = 0;
  return {
    minDepth,
    maxDepth: hasOpenMax ? -1 : maxDepth,
  };
}

function normalizeMethod(method: string): string {
  const source = typeof method === 'string' ? method : String(method);
  let start = 0;
  let end = source.length;
  while (start < end && source.charCodeAt(start) <= 32) start += 1;
  while (end > start && source.charCodeAt(end - 1) <= 32) end -= 1;
  const trimmed = start === 0 && end === source.length ? source : source.slice(start, end);
  const cached = methodCache[trimmed];
  if (cached) return cached;
  const normalized = trimmed.toUpperCase();
  methodCache[trimmed] = normalized;
  return normalized;
}

function normalizePath(path: string): string {
  if (path.length === 0) return '/';
  return path.charCodeAt(0) === 47 ? path : `/${path}`;
}

function splitPath(path: string): string[] {
  if (path === '/') return [];
  const segments: string[] = [];
  let start = 0;
  for (let i = 0; i < path.length; i += 1) {
    if (path.charCodeAt(i) === 47) {
      if (i > start) segments.push(path.slice(start, i));
      start = i + 1;
    }
  }
  if (start < path.length) segments.push(path.slice(start));
  return segments;
}
