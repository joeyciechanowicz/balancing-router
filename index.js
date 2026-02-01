'use strict';

/**
 * @typedef {(req: any, res: any, params: Record<string, string>) => any} RouteHandler
 * @typedef {{ handler: RouteHandler, params: Record<string, string>, store?: any }} RouteMatch
 * @typedef {{ rebalanceInterval?: number }} RouterOptions
 */

/**
 * @typedef {{
 *  kind: 'param' | 'wildcard',
 *  name: string,
 *  node: RouteNode,
 *  regex?: RegExp,
 *  hits: number
 * }} DynamicChild
 */

/**
 * @typedef {{
 *  regex: RegExp,
 *  handlers: Map<string, RouteHandlerRecord>,
 *  hits: number
 * }} RegexRoute
 */

/**
 * @typedef {{ handler: RouteHandler, store?: any, hits: number }} RouteHandlerRecord
 */

class RouteNode {
  constructor() {
    this.staticChildren = new Map();
    /** @type {DynamicChild[]} */
    this.paramChildren = [];
    /** @type {DynamicChild[]} */
    this.wildcardChildren = [];
    /** @type {RegexRoute[]} */
    this.regexRoutes = [];
    /** @type {Map<string, RouteHandlerRecord>} */
    this.handlers = new Map();
  }
}

class Router {
  /**
   * @param {RouterOptions} [options]
   */
  constructor(options = {}) {
    this.options = {
      rebalanceInterval: 1000,
      ...options,
    };
    this._root = new RouteNode();
    this._lookupCount = 0;
  }

  /**
   * @param {string | string[]} method
   * @param {string | RegExp} path
   * @param {RouteHandler} handler
   * @param {any} [store]
   */
  on(method, path, handler, store) {
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

  /**
   * @param {string} method
   * @param {string} path
   * @returns {RouteMatch | null}
   */
  find(method, path) {
    const methodKey = normalizeMethod(method);
    const pathStr = normalizePath(path);
    const segments = splitPath(pathStr);
    this._lookupCount += 1;
    if (this.options.rebalanceInterval > 0 && this._lookupCount % this.options.rebalanceInterval === 0) {
      this.rebalance();
    }

    const match = this._walk(this._root, segments, 0, methodKey, pathStr, {});
    if (!match && methodKey !== '*') {
      return this._walk(this._root, segments, 0, '*', pathStr, {});
    }
    return match;
  }

  rebalance() {
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

  /**
   * @param {string} method
   * @param {string} path
   * @param {RouteHandler} handler
   * @param {any} [store]
   */
  _addRoute(method, path, handler, store) {
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

  /**
   * @param {string} method
   * @param {RegExp} regex
   * @param {RouteHandler} handler
   * @param {any} [store]
   */
  _addRegexRoute(method, regex, handler, store) {
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

  /**
   * @param {RouteNode} node
   * @param {string[]} segments
   * @param {number} index
   * @param {string} method
   * @param {string} pathStr
   * @param {Record<string, string>} params
   * @returns {RouteMatch | null}
   */
  _walk(node, segments, index, method, pathStr, params) {
    if (index === segments.length) {
      const handlerRecord = node.handlers.get(method);
      if (handlerRecord) {
        handlerRecord.hits += 1;
        return { handler: handlerRecord.handler, params, store: handlerRecord.store };
      }

      for (const child of node.wildcardChildren) {
        const nextParams = { ...params, [child.name]: '' };
        const result = this._walk(child.node, segments, segments.length, method, pathStr, nextParams);
        if (result) {
          child.hits += 1;
          return result;
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
        const nextParams = { ...params, [child.name]: segment };
        const result = this._walk(child.node, segments, index + 1, method, pathStr, nextParams);
        if (result) {
          child.hits += 1;
          return result;
        }
      }

      for (const child of node.wildcardChildren) {
        const rest = segments.slice(index).join('/');
        const nextParams = { ...params, [child.name]: rest };
        const result = this._walk(child.node, segments, segments.length, method, pathStr, nextParams);
        if (result) {
          child.hits += 1;
          return result;
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

  /**
   * @param {RouteNode} node
   * @param {string} segment
   */
  _ensureStaticChild(node, segment) {
    let child = node.staticChildren.get(segment);
    if (!child) {
      child = new RouteNode();
      node.staticChildren.set(segment, child);
    }
    return child;
  }

  /**
   * @param {RouteNode} node
   * @param {string} name
   * @param {RegExp | undefined} regex
   * @returns {DynamicChild}
   */
  _ensureParamChild(node, name, regex) {
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

  /**
   * @param {RouteNode} node
   * @param {string} name
   * @returns {DynamicChild}
   */
  _ensureWildcardChild(node, name) {
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

  /**
   * @param {RouteNode | RegexRoute} target
   * @param {string} method
   * @param {RouteHandler} handler
   * @param {any} [store]
   */
  _registerHandler(target, method, handler, store) {
    const key = normalizeMethod(method);
    target.handlers.set(key, { handler, store, hits: 0 });
  }
}

/**
 * @param {RouterOptions} [options]
 */
function createRouter(options) {
  return new Router(options);
}

/**
 * @param {string} method
 */
function normalizeMethod(method) {
  const value = String(method || '*').trim();
  return value === '' ? '*' : value.toUpperCase();
}

/**
 * @param {string} path
 */
function normalizePath(path) {
  if (path == null) return '/';
  const value = String(path);
  if (value === '' || value === '/') return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

/**
 * @param {string} path
 */
function splitPath(path) {
  if (path === '/') return [];
  return path.split('/').filter(Boolean);
}

/**
 * @param {string} segment
 * @returns {{ name: string, pattern?: string, wildcard?: boolean } | null}
 */
function parseParamSegment(segment) {
  if (!segment.startsWith(':')) return null;
  const wildcardMatch = segment.match(/^:([A-Za-z0-9_]+)\*$/);
  if (wildcardMatch) {
    return { name: wildcardMatch[1], pattern: undefined, wildcard: true };
  }
  const match = segment.match(/^:([A-Za-z0-9_]+)(?:\((.+)\))?$/);
  if (!match) return null;
  return { name: match[1], pattern: match[2] };
}

/**
 * Extracts a literal prefix from a regex (best-effort).
 * @param {RegExp} regex
 */
function extractRegexLiteralPrefix(regex) {
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

/**
 * @param {RegExp | undefined} a
 * @param {RegExp | undefined} b
 */
function matchRegex(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.source === b.source && a.flags === b.flags;
}

module.exports = {
  Router,
  createRouter,
};
