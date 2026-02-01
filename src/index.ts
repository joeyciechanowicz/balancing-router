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

class RouteNode {
  staticChildren = new Map<string, RouteNode>();
  paramChildren: DynamicChild[] = [];
  wildcardChildren: DynamicChild[] = [];
  regexRoutes: RegexRoute[] = [];
  handlers = new Map<string, RouteHandlerRecord>();
}

export class Router {
  private readonly _root = new RouteNode();

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
    const methodKey = normalizeMethod(method);
    const pathStr = normalizePath(path);
    const segments = splitPath(pathStr);
    const match = this._walk(this._root, segments, 0, methodKey, pathStr, {});
    if (!match && methodKey !== '*') {
      return this._walk(this._root, segments, 0, '*', pathStr, {});
    }
    return match;
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
    if (index === segments.length) {
      const handlerRecord = node.handlers.get(method);
      if (handlerRecord) {
        handlerRecord.hits += 1;
        return { handler: handlerRecord.handler, params, store: handlerRecord.store };
      }

      for (const child of node.wildcardChildren) {
        const prev = params[child.name];
        const hadPrev = Object.prototype.hasOwnProperty.call(params, child.name);
        params[child.name] = '';
        const result = this._walk(child.node, segments, segments.length, method, pathStr, params);
        if (result) {
          child.hits += 1;
          return result;
        }
        if (hadPrev) {
          params[child.name] = prev;
        } else {
          delete params[child.name];
        }
      }
    }

    if (index < segments.length) {
      const segment = segments[index];
      const staticChild = node.staticChildren.get(segment);
      if (staticChild) {
        const result = this._walk(staticChild, segments, index + 1, method, pathStr, params);
        if (result) return result;
      }

      for (const child of node.paramChildren) {
        if (child.regex && !child.regex.test(segment)) {
          continue;
        }
        const prev = params[child.name];
        const hadPrev = Object.prototype.hasOwnProperty.call(params, child.name);
        params[child.name] = segment;
        const result = this._walk(child.node, segments, index + 1, method, pathStr, params);
        if (result) {
          child.hits += 1;
          return result;
        }
        if (hadPrev) {
          params[child.name] = prev;
        } else {
          delete params[child.name];
        }
      }

      for (const child of node.wildcardChildren) {
        const rest = segments.slice(index).join('/');
        const prev = params[child.name];
        const hadPrev = Object.prototype.hasOwnProperty.call(params, child.name);
        params[child.name] = rest;
        const result = this._walk(child.node, segments, segments.length, method, pathStr, params);
        if (result) {
          child.hits += 1;
          return result;
        }
        if (hadPrev) {
          params[child.name] = prev;
        } else {
          delete params[child.name];
        }
      }
    }

    if (node.regexRoutes.length) {
      for (const route of node.regexRoutes) {
        if (!route.regex.test(pathStr)) continue;
        const handlerRecord = route.handlers.get(method);
        if (!handlerRecord) continue;
        route.hits += 1;
        handlerRecord.hits += 1;
        return { handler: handlerRecord.handler, params, store: handlerRecord.store };
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
}

export function createRouter(): Router {
  return new Router();
}

function normalizeMethod(method: string): string {
  const value = String(method || '*').trim();
  return value === '' ? '*' : value.toUpperCase();
}

function normalizePath(path: string): string {
  if (path == null) return '/';
  const value = String(path);
  if (value === '' || value === '/') return '/';
  return value.startsWith('/') ? value : `/${value}`;
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
