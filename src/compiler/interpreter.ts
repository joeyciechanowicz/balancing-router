import type { RouteHandler, RouteMatch } from '../index';
import { buildRouteIrFromPattern } from './ir';
import type { RouteIrVariant } from './types';

interface CompiledVariant {
  segments: CompiledSegment[];
}

type CompiledSegment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string; regex?: RegExp }
  | { kind: 'wildcard'; name: string };

interface CompiledRoute {
  method: string;
  variants: CompiledVariant[];
  handler: RouteHandler;
  store?: any;
  order: number;
}

const methodCache = Object.create(null) as Record<string, string>;
const EMPTY_PARAMS = Object.create(null) as Record<string, string>;

export class IrInterpreterRouter {
  private readonly _routes: CompiledRoute[] = [];
  private _order = 0;

  on(method: string | string[], path: string, handler: RouteHandler, store?: any): this {
    const methods = Array.isArray(method) ? method : [method];
    const ir = buildRouteIrFromPattern(path);
    const compiledVariants = ir.variants.map((variant) => compileVariant(variant));
    for (const item of methods) {
      this._routes.push({
        method: normalizeMethod(item),
        variants: compiledVariants,
        handler,
        store,
        order: this._order++,
      });
    }
    return this;
  }

  find(method: string, path: string): RouteMatch | null {
    const methodKey = normalizeMethod(method);
    const pathStr = normalizePath(path);
    const segments = splitPath(pathStr);

    let wildcardMatch: RouteMatch | null = null;
    let wildcardOrder = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this._routes.length; i += 1) {
      const route = this._routes[i];
      const match = matchRoute(route.variants, segments);
      if (!match) continue;

      if (route.method === methodKey) {
        return {
          handler: route.handler,
          params: match,
          store: route.store,
        };
      }

      if (route.method === '*' && route.order < wildcardOrder) {
        wildcardMatch = {
          handler: route.handler,
          params: match,
          store: route.store,
        };
        wildcardOrder = route.order;
      }
    }

    return wildcardMatch;
  }
}

export function createIrInterpreterRouter(): IrInterpreterRouter {
  return new IrInterpreterRouter();
}

function compileVariant(variant: RouteIrVariant): CompiledVariant {
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

function matchRoute(variants: CompiledVariant[], pathSegments: string[]): Record<string, string> | null {
  for (let i = 0; i < variants.length; i += 1) {
    const params = matchVariant(variants[i], pathSegments);
    if (params) return params;
  }
  return null;
}

function matchVariant(variant: CompiledVariant, pathSegments: string[]): Record<string, string> | null {
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

    if (segment.regex && !segment.regex.test(value)) {
      return null;
    }
    if (!params) params = Object.create(null) as Record<string, string>;
    params[segment.name] = value;
    pathIndex += 1;
  }

  if (pathIndex !== pathSegments.length) return null;
  return params ?? EMPTY_PARAMS;
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

