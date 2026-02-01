export type RouteHandler = (req: any, res: any, params: Record<string, string>) => any;

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
  store?: any;
}


interface RouteHandlerRecord {
  handler: RouteHandler;
  store?: any;
  hits: number;
}

interface RegexRoute {
  regex: RegExp;
  handlers: Map<string, RouteHandlerRecord>;
  hits: number;
}

interface DynamicChild {
  kind: 'param' | 'wildcard';
  name: string;
  node: RouteNode;
  regex?: RegExp;
  hits: number;
}

const methodCache = new Map<string, string>();

class RouteNode {
  staticChildren = new Map<string, RouteNode>();
  paramChildren: DynamicChild[] = [];
  wildcardChildren: DynamicChild[] = [];
  regexRoutes: RegexRoute[] = [];
  regexMinDepths: number[] = [];
  handlers = new Map<string, RouteHandlerRecord>();
}

export class Router {
  private readonly _root = new RouteNode();
  private readonly _cache = new Map<string, Map<string, RouteMatch | null>>();
  private _cacheKeys: Array<{ method: string; path: string }> = [];
  private _cacheLimit = 1024;
  private _cacheSize = 0;

  constructor() {}

  on(method: string | string[], path: string | RegExp, handler: RouteHandler, store?: any): this {
    const methods = Array.isArray(method) ? method : [method];
    for (const m of methods) {
      if (path instanceof RegExp) {
        this._addRegexRoute(String(m), path, handler, store);
      } else {
        this._addRoute(String(m), path, handler, store);
      }
    }
    return this;
  }

  find(method: string, path: string): RouteMatch | null {
    let methodKey: string;
    if (typeof method === 'string') {
      const cached = methodCache.get(method);
      if (cached) {
        methodKey = cached;
      } else {
        methodKey = normalizeMethod(method);
      }
    } else {
      methodKey = normalizeMethod(method);
    }
    const pathStr = normalizePath(path);
    const methodMap = this._cache.get(methodKey);
    const cached = methodMap?.get(pathStr);
    if (cached !== undefined) {
      return cached;
    }
    const segments = splitPath(pathStr);
    const match = this._walk(this._root, segments, 0, methodKey, pathStr, {});
    let resolved = match;
    if (!resolved && methodKey !== '*') {
      resolved = this._walk(this._root, segments, 0, '*', pathStr, {});
    }
    this._cacheSet(methodKey, pathStr, resolved);
    return resolved;
  }

  rebalance(): void {
    const stack = [this._root];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      node.paramChildren.sort((a, b) => b.hits - a.hits);
      node.wildcardChildren.sort((a, b) => b.hits - a.hits);
      node.regexRoutes.sort((a, b) => b.hits - a.hits);
      for (const child of node.staticChildren.values()) {
        stack.push(child);
      }
      for (const child of node.paramChildren) stack.push(child.node);
      for (const child of node.wildcardChildren) stack.push(child.node);
    }
  }

  private _addRoute(method: string, path: string, handler: RouteHandler, store?: any): void {
    const methodKey = normalizeMethod(method);
    const pathStr = normalizePath(path);
    const segments = splitPath(pathStr);
    let node = this._root;

    for (const segment of segments) {
      if (segment === '*') {
        const wildcardChild = this._ensureWildcardChild(node, '*');
        node = wildcardChild.node;
        break;
      }
      const paramMatch = parseParamSegment(segment);
      if (paramMatch) {
        const { name, pattern, wildcard } = paramMatch;
        if (wildcard) {
          const wildcardChild = this._ensureWildcardChild(node, name);
          node = wildcardChild.node;
          break;
        }
        const regex = pattern ? new RegExp(`^${pattern}$`) : undefined;
        const child = this._ensureParamChild(node, name, regex);
        node = child.node;
        continue;
      }
      node = this._ensureStaticChild(node, segment);
    }

    this._registerHandler(node, methodKey, handler, store);
  }

  private _addRegexRoute(method: string, regex: RegExp, handler: RouteHandler, store?: any): void {
    const methodKey = normalizeMethod(method);
    const prefix = extractRegexLiteralPrefix(regex);
    const lastSlash = prefix.lastIndexOf('/');
    const safePrefix = lastSlash > 0 ? prefix.slice(0, lastSlash) : prefix;
    const prefixSegments = splitPath(safePrefix);
    const minDepth = prefixSegments.length;
    let node = this._root;
    for (const segment of prefixSegments) {
      node = this._ensureStaticChild(node, segment);
    }

    let existing = node.regexRoutes.find((route) => route.regex.source === regex.source && route.regex.flags === regex.flags);
    if (!existing) {
      existing = {
        regex,
        handlers: new Map(),
        hits: 0,
      };
      node.regexRoutes.push(existing);
      node.regexMinDepths.push(minDepth);
    }
    this._registerHandler(existing, methodKey, handler, store);
  }

  private _walk(
    node: RouteNode,
    segments: string[],
    index: number,
    method: string,
    pathStr: string,
    params: Record<string, string>,
  ): RouteMatch | null {
    type WalkFrame =
      | {
          type: 'visit';
          node: RouteNode;
          index: number;
          paramName?: string;
          paramValue?: string;
          dynamicChild?: DynamicChild;
        }
      | { type: 'restore'; name: string; hadPrev: boolean; prev?: string }
      | { type: 'popDynamic' }
      | { type: 'regex'; node: RouteNode };

    const stack: WalkFrame[] = [{ type: 'visit', node, index }];
    const dynamicPath: DynamicChild[] = [];

    while (stack.length) {
      const frame = stack.pop()!;
      if (frame.type === 'restore') {
        if (frame.hadPrev) {
          params[frame.name] = frame.prev as string;
        } else {
          delete params[frame.name];
        }
        continue;
      }
      if (frame.type === 'popDynamic') {
        dynamicPath.pop();
        continue;
      }
      if (frame.type === 'regex') {
        if (frame.node.regexRoutes.length) {
          for (let i = 0; i < frame.node.regexRoutes.length; i += 1) {
            if (frame.node.regexMinDepths[i] > segments.length) continue;
            const route = frame.node.regexRoutes[i];
            if (!route.regex.test(pathStr)) continue;
            const handlerRecord = route.handlers.get(method);
            if (!handlerRecord) continue;
            route.hits += 1;
            handlerRecord.hits += 1;
            for (const child of dynamicPath) child.hits += 1;
            return { handler: handlerRecord.handler, params, store: handlerRecord.store };
          }
        }
        continue;
      }

      if (frame.paramName !== undefined) {
        params[frame.paramName] = frame.paramValue as string;
      }
      if (frame.dynamicChild) {
        dynamicPath.push(frame.dynamicChild);
      }

      const currentNode = frame.node;
      const idx = frame.index;

      if (idx === segments.length) {
        const handlerRecord = currentNode.handlers.get(method);
        if (handlerRecord) {
          handlerRecord.hits += 1;
          for (const child of dynamicPath) child.hits += 1;
          return { handler: handlerRecord.handler, params, store: handlerRecord.store };
        }

        if (currentNode.regexRoutes.length) {
          stack.push({ type: 'regex', node: currentNode });
        }

        if (currentNode.wildcardChildren.length) {
          for (let i = currentNode.wildcardChildren.length - 1; i >= 0; i -= 1) {
            const child = currentNode.wildcardChildren[i];
            const prev = params[child.name];
            const hadPrev = Object.prototype.hasOwnProperty.call(params, child.name);
            stack.push({ type: 'restore', name: child.name, hadPrev, prev });
            stack.push({ type: 'popDynamic' });
            stack.push({
              type: 'visit',
              node: child.node,
              index: segments.length,
              paramName: child.name,
              paramValue: '',
              dynamicChild: child,
            });
          }
        }

        continue;
      }

      if (currentNode.regexRoutes.length) {
        stack.push({ type: 'regex', node: currentNode });
      }

      const segment = segments[idx];

      if (currentNode.wildcardChildren.length) {
        const rest = segments.slice(idx).join('/');
        for (let i = currentNode.wildcardChildren.length - 1; i >= 0; i -= 1) {
          const child = currentNode.wildcardChildren[i];
          const prev = params[child.name];
          const hadPrev = Object.prototype.hasOwnProperty.call(params, child.name);
          stack.push({ type: 'restore', name: child.name, hadPrev, prev });
          stack.push({ type: 'popDynamic' });
          stack.push({
            type: 'visit',
            node: child.node,
            index: segments.length,
            paramName: child.name,
            paramValue: rest,
            dynamicChild: child,
          });
        }
      }

      if (currentNode.paramChildren.length) {
        for (let i = currentNode.paramChildren.length - 1; i >= 0; i -= 1) {
          const child = currentNode.paramChildren[i];
          if (child.regex && !child.regex.test(segment)) {
            continue;
          }
          const prev = params[child.name];
          const hadPrev = Object.prototype.hasOwnProperty.call(params, child.name);
          stack.push({ type: 'restore', name: child.name, hadPrev, prev });
          stack.push({ type: 'popDynamic' });
          stack.push({
            type: 'visit',
            node: child.node,
            index: idx + 1,
            paramName: child.name,
            paramValue: segment,
            dynamicChild: child,
          });
        }
      }

      const staticChild = currentNode.staticChildren.get(segment);
      if (staticChild) {
        stack.push({ type: 'visit', node: staticChild, index: idx + 1 });
      }
    }

    return null;
  }

  private _ensureStaticChild(node: RouteNode, segment: string): RouteNode {
    let child = node.staticChildren.get(segment);
    if (!child) {
      child = new RouteNode();
      node.staticChildren.set(segment, child);
    }
    return child;
  }

  private _ensureParamChild(node: RouteNode, name: string, regex?: RegExp): DynamicChild {
    let child = node.paramChildren.find((entry) => entry.name === name && matchRegex(entry.regex, regex));
    if (!child) {
      child = {
        kind: 'param',
        name,
        node: new RouteNode(),
        regex,
        hits: 0,
      };
      node.paramChildren.push(child);
    }
    return child;
  }

  private _ensureWildcardChild(node: RouteNode, name: string): DynamicChild {
    let child = node.wildcardChildren.find((entry) => entry.name === name);
    if (!child) {
      child = {
        kind: 'wildcard',
        name,
        node: new RouteNode(),
        hits: 0,
      };
      node.wildcardChildren.push(child);
    }
    return child;
  }

  private _registerHandler(
    target: RouteNode | RegexRoute,
    method: string,
    handler: RouteHandler,
    store?: any,
  ): void {
    const key = normalizeMethod(method);
    target.handlers.set(key, { handler, store, hits: 0 });
  }

  private _cacheSet(method: string, path: string, value: RouteMatch | null): void {
    let methodCache = this._cache.get(method);
    if (!methodCache) {
      methodCache = new Map();
      this._cache.set(method, methodCache);
    }
    if (methodCache.has(path)) {
      methodCache.set(path, value);
      return;
    }
    if (this._cacheSize >= this._cacheLimit) {
      const oldest = this._cacheKeys.shift();
      if (oldest) {
        const oldMethodCache = this._cache.get(oldest.method);
        if (oldMethodCache) {
          oldMethodCache.delete(oldest.path);
          if (oldMethodCache.size === 0) this._cache.delete(oldest.method);
          this._cacheSize = Math.max(0, this._cacheSize - 1);
        }
      }
    }
    this._cacheKeys.push({ method, path });
    methodCache.set(path, value);
    this._cacheSize += 1;
  }
}

export function createRouter(): Router {
  return new Router();
}

function normalizeMethod(method: string): string {
  if (method == null) return '*';
  if (typeof method === 'string') {
    const cached = methodCache.get(method);
    if (cached) return cached;
    const value = method.trim();
    const normalized = value === '' ? '*' : value.toUpperCase();
    methodCache.set(method, normalized);
    return normalized;
  }
  const value = String(method).trim();
  return value === '' ? '*' : value.toUpperCase();
}

function normalizePath(path: string): string {
  if (path == null) return '/';
  if (typeof path === 'string') {
    if (path === '' || path === '/') return '/';
    return path.charCodeAt(0) === 47 ? path : `/${path}`;
  }
  const value = String(path);
  if (value === '' || value === '/') return '/';
  return value.charCodeAt(0) === 47 ? value : `/${value}`;
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
  if (start < path.length) {
    segments.push(path.slice(start));
  }
  return segments;
}

function parseParamSegment(segment: string): { name: string; pattern?: string; wildcard?: boolean } | null {
  if (!segment.startsWith(':')) return null;
  const wildcardMatch = segment.match(/^:([A-Za-z0-9_]+)\*$/);
  if (wildcardMatch) {
    return { name: wildcardMatch[1], pattern: undefined, wildcard: true };
  }
  const match = segment.match(/^:([A-Za-z0-9_]+)(?:\((.+)\))?$/);
  if (!match) return null;
  return { name: match[1], pattern: match[2] };
}

function extractRegexLiteralPrefix(regex: RegExp): string {
  const source = regex.source;
  let index = 0;
  let prefix = '';
  if (source.startsWith('^')) index += 1;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      const next = source[index + 1];
      if (!next) break;
      if (/[dDsSwWbB]/.test(next)) break;
      if (next === 'x' || next === 'u' || next === 'p' || next === 'P' || next === 'k' || next === 'c') break;
      prefix += next;
      index += 1;
      continue;
    }
    if ('[](){}.*+?|$^'.includes(char)) break;
    prefix += char;
  }
  return prefix;
}

function matchRegex(a?: RegExp, b?: RegExp): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.source === b.source && a.flags === b.flags;
}
