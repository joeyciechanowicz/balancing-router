export type RouteHandler = (req: any, res: any, params: Record<string, string>) => any;

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
  store?: any;
}

interface RouteDef {
  method: string;
  path: string | RegExp;
  handler: RouteHandler;
  store?: any;
  order: number;
}

interface RegexRouteDef {
  regex: RegExp;
  handler: RouteHandler;
  store?: any;
  minDepth: number;
  order: number;
}

type SegmentToken =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string; pattern?: string }
  | { kind: 'wildcard'; name: string };

interface ValidatorEntry {
  kind: 'none' | 'int' | 'alpha' | 'slug' | 'locale' | 'uuid' | 'regex';
  code: number;
  regex?: RegExp;
}

interface BuildDynEdge {
  kind: 'param' | 'wildcard';
  name: string;
  validatorId: number;
  next: BuildState;
  score: number;
  order: number;
}

class BuildState {
  staticEdges = new Map<string, BuildState>();
  dynEdges: BuildDynEdge[] = [];
  acceptIndex = -1;
}

interface AcceptRecord {
  handler: RouteHandler;
  store?: any;
}

interface MethodAutomaton {
  stateStaticOffset: Int32Array;
  stateStaticCount: Int32Array;
  stateDynOffset: Int32Array;
  stateDynCount: Int32Array;
  stateAcceptIndex: Int32Array;
  staticLiteralIds: Int32Array;
  staticNext: Int32Array;
  dynKind: Uint8Array;
  dynNameIds: Int32Array;
  dynValidatorIds: Int32Array;
  dynNext: Int32Array;
  stateStaticMaps: Array<Record<string, number> | null>;
  literals: string[];
  paramNames: string[];
  accepts: AcceptRecord[];
}

const DYN_PARAM = 1;
const DYN_WILDCARD = 2;
const VAL_NONE = 0;
const VAL_INT = 1;
const VAL_ALPHA = 2;
const VAL_SLUG = 3;
const VAL_LOCALE = 4;
const VAL_UUID = 5;
const VAL_REGEX = 6;
const EMPTY_PARAMS = Object.create(null) as Record<string, string>;
const methodCache = Object.create(null) as Record<string, string>;
const VALIDATOR_ALIAS_CODES = Object.freeze({
  int: VAL_INT,
  alpha: VAL_ALPHA,
  slug: VAL_SLUG,
  locale: VAL_LOCALE,
  uuid: VAL_UUID,
} as const);

export class AutomatonRouter {
  private readonly _routes: RouteDef[] = [];
  private _compiled = false;
  private _routeOrder = 0;

  private readonly _automata = new Map<string, MethodAutomaton>();
  private _automatonGET: MethodAutomaton | null = null;
  private _automatonWildcard: MethodAutomaton | null = null;
  private readonly _regexRoutes = new Map<string, RegexRouteDef[]>();
  private _hasRegexRoutes = false;
  private readonly _validators: ValidatorEntry[] = [{ kind: 'none', code: VAL_NONE }];
  private readonly _validatorCache = new Map<string, number>();
  private _stateStack: number[] = [0];
  private _indexStack: number[] = [0];
  private _capStack: number[] = [0];
  private _capNameIds: number[] = [0];
  private _capValues: string[] = [''];
  private _capRestFrom: number[] = [0];
  private _capRestEpoch: number[] = [0];
  private _capEpochCounter = 1;
  private _cacheLimit = 1_000_000;
  private _cacheGET: Record<string, RouteMatch | null> = Object.create(null);
  private _cacheOther = new Map<string, Record<string, RouteMatch | null>>();
  private _cacheMethods: string[] = new Array(this._cacheLimit);
  private _cachePaths: string[] = new Array(this._cacheLimit);
  private _cacheSize = 0;
  private _cacheIndex = 0;
  private _segmentStarts: number[] = [0];
  private _segmentEnds: number[] = [0];

  on(method: string | string[], path: string | RegExp, handler: RouteHandler, store?: any): this {
    const methods = Array.isArray(method) ? method : [method];
    for (const methodItem of methods) {
      this._routes.push({
        method: normalizeMethod(methodItem),
        path,
        handler,
        store,
        order: this._routeOrder++,
      });
    }
    this._compiled = false;
    return this;
  }

  find(method: string, path: string): RouteMatch | null {
    this._ensureCompiled();

    const pathStr = path.charCodeAt(0) === 47 ? path : path.length === 0 ? '/' : `/${path}`;

    if (method === 'GET') {
      const cached = this._cacheGET[pathStr];
      if (cached !== undefined) return cached;
      const resolved = this._findResolved('GET', pathStr);
      this._cacheSetGET(pathStr, resolved);
      return resolved;
    }

    let methodKey: string;
    switch (method) {
      case 'POST':
      case 'PUT':
      case 'PATCH':
      case 'DELETE':
      case 'HEAD':
      case 'OPTIONS':
      case '*':
        methodKey = method;
        break;
      default:
        methodKey = normalizeMethod(method);
        break;
    }
    const methodCacheEntry = this._getMethodCache(methodKey);
    if (methodCacheEntry) {
      const cached = methodCacheEntry[pathStr];
      if (cached !== undefined) return cached;
    }
    const resolved = this._findResolved(methodKey, pathStr);
    this._cacheSet(methodKey, pathStr, resolved);
    return resolved;
  }

  private _findResolved(methodKey: string, pathStr: string): RouteMatch | null {
    const depth = this._scanPathSegments(pathStr);

    const methodAutomaton =
      methodKey === 'GET' ? this._automatonGET : methodKey === '*' ? this._automatonWildcard : this._automata.get(methodKey);
    if (methodAutomaton) {
      const match = this._findInAutomaton(methodAutomaton, pathStr, depth);
      if (match) return match;
    }

    if (methodKey !== '*' && this._automatonWildcard) {
      const match = this._findInAutomaton(this._automatonWildcard, pathStr, depth);
      if (match) return match;
    }

    if (this._hasRegexRoutes) {
      const regexMatch = this._findInRegex(methodKey, pathStr, depth);
      if (regexMatch) return regexMatch;

      if (methodKey !== '*') {
        return this._findInRegex('*', pathStr, depth);
      }
    }

    return null;
  }

  rebalance(): void {
    // v2 router is immutable at runtime; no-op for API compatibility.
  }

  private _findInRegex(method: string, path: string, depth: number): RouteMatch | null {
    const routes = this._regexRoutes.get(method);
    if (!routes || routes.length === 0) return null;
    for (let i = 0; i < routes.length; i += 1) {
      const route = routes[i];
      if (route.minDepth > depth) continue;
      if (!route.regex.test(path)) continue;
      return { handler: route.handler, params: EMPTY_PARAMS, store: route.store };
    }
    return null;
  }

  private _findInAutomaton(automaton: MethodAutomaton, path: string, depth: number): RouteMatch | null {
    const validators = this._validators;
    const dynKind = automaton.dynKind;
    const dynNameIds = automaton.dynNameIds;
    const dynValidatorIds = automaton.dynValidatorIds;
    const dynNext = automaton.dynNext;
    const stateDynOffset = automaton.stateDynOffset;
    const stateDynCount = automaton.stateDynCount;
    const stateAcceptIndex = automaton.stateAcceptIndex;
    const stateStaticMaps = automaton.stateStaticMaps;
    const paramNames = automaton.paramNames;
    const accepts = automaton.accepts;
    const stateStack = this._stateStack;
    const indexStack = this._indexStack;
    const capStack = this._capStack;
    const capNameIds = this._capNameIds;
    const capValues = this._capValues;
    const capRestFrom = this._capRestFrom;
    const capRestEpoch = this._capRestEpoch;
    const segmentStarts = this._segmentStarts;
    const segmentEnds = this._segmentEnds;
    let capEpoch = this._capEpochCounter + 1;
    if (capEpoch === 0) capEpoch = 1;
    this._capEpochCounter = capEpoch;

    let top = 0;
    stateStack[top] = 0;
    indexStack[top] = 0;
    capStack[top] = 0;

    const push = (
      state: number,
      index: number,
      capCount: number,
      capNameId: number,
      capValue: string,
      restFrom: number,
    ): void => {
      top += 1;
      if (top >= stateStack.length) {
        const growBy = stateStack.length;
        for (let i = 0; i < growBy; i += 1) {
          stateStack.push(0);
          indexStack.push(0);
          capStack.push(0);
        }
      }
      stateStack[top] = state;
      indexStack[top] = index;
      const nextCapCount = capCount + (capNameId >= 0 ? 1 : 0);
      capStack[top] = nextCapCount;
      if (capNameId >= 0) {
        if (capCount >= capNameIds.length) {
          const growBy = capNameIds.length;
          for (let i = 0; i < growBy; i += 1) {
            capNameIds.push(0);
            capValues.push('');
            capRestFrom.push(0);
            capRestEpoch.push(0);
          }
        }
        capNameIds[capCount] = capNameId;
        capValues[capCount] = capValue;
        if (restFrom >= 0) {
          capRestFrom[capCount] = restFrom;
          capRestEpoch[capCount] = capEpoch;
        }
      }
    };

    while (top >= 0) {
      const state = stateStack[top];
      const index = indexStack[top];
      const capCount = capStack[top];
      top -= 1;

      if (index === depth) {
        const acceptIndex = stateAcceptIndex[state];
        if (acceptIndex >= 0) {
          const accept = accepts[acceptIndex];
          if (capCount === 0) {
            return { handler: accept.handler, params: EMPTY_PARAMS, store: accept.store };
          }
          const params = Object.create(null) as Record<string, string>;
          for (let i = 0; i < capCount; i += 1) {
            params[paramNames[capNameIds[i]]] =
              capRestEpoch[i] === capEpoch
                ? buildRestFromPositions(path, segmentStarts, segmentEnds, capRestFrom[i], depth)
                : capValues[i];
          }
          return { handler: accept.handler, params, store: accept.store };
        }

        const dynStart = stateDynOffset[state];
        const dynCount = stateDynCount[state];
        for (let i = dynCount - 1; i >= 0; i -= 1) {
          const edgeIndex = dynStart + i;
          if (dynKind[edgeIndex] !== DYN_WILDCARD) continue;
          push(dynNext[edgeIndex], depth, capCount, dynNameIds[edgeIndex], '', depth);
        }
        continue;
      }

      const segment = path.slice(segmentStarts[index], segmentEnds[index]);

      const dynStart = stateDynOffset[state];
      const dynCount = stateDynCount[state];
      for (let i = dynCount - 1; i >= 0; i -= 1) {
        const edgeIndex = dynStart + i;
        const kind = dynKind[edgeIndex];
        if (kind === DYN_PARAM) {
          const validatorId = dynValidatorIds[edgeIndex];
          const validator = validators[validatorId];
          switch (validator.code) {
            case VAL_NONE:
              break;
            case VAL_INT:
              if (!isIntSegment(segment)) continue;
              break;
            case VAL_ALPHA:
              if (!isAlphaSegment(segment)) continue;
              break;
            case VAL_SLUG:
              if (!isSlugSegment(segment)) continue;
              break;
            case VAL_LOCALE:
              if (!isLocaleSegment(segment)) continue;
              break;
            case VAL_UUID:
              if (!isUuidSegment(segment)) continue;
              break;
            case VAL_REGEX:
              if (!validator.regex || !validator.regex.test(segment)) continue;
              break;
            default:
              continue;
          }
          push(dynNext[edgeIndex], index + 1, capCount, dynNameIds[edgeIndex], segment, -1);
          continue;
        }
        if (kind === DYN_WILDCARD) {
          push(dynNext[edgeIndex], depth, capCount, dynNameIds[edgeIndex], '', index);
        }
      }

      const staticMap = stateStaticMaps[state];
      if (staticMap) {
        const staticNext = staticMap[segment];
        if (staticNext !== undefined) {
          push(staticNext, index + 1, capCount, -1, '', -1);
        }
      }
    }

    void path;
    return null;
  }

  private _scanPathSegments(path: string): number {
    const starts = this._segmentStarts;
    const ends = this._segmentEnds;
    const pathLen = path.length;
    if (pathLen <= 1) return 0;
    let depth = 0;
    let start = 1;
    let slash = path.indexOf('/', start);
    if (slash === -1) {
      if (starts.length === 0) starts.push(start);
      else starts[0] = start;
      if (ends.length === 0) ends.push(pathLen);
      else ends[0] = pathLen;
      return 1;
    }

    while (slash !== -1) {
      if (slash > start) {
        if (depth >= starts.length) {
          starts.push(start);
          ends.push(slash);
        } else {
          starts[depth] = start;
          ends[depth] = slash;
        }
        depth += 1;
      }
      start = slash + 1;
      slash = path.indexOf('/', start);
    }

    if (start < pathLen) {
      if (depth >= starts.length) {
        starts.push(start);
        ends.push(pathLen);
      } else {
        starts[depth] = start;
        ends[depth] = pathLen;
      }
      depth += 1;
    }

    return depth;
  }

  private _ensureCompiled(): void {
    if (this._compiled) return;
    this._compile();
    this._cacheGET = Object.create(null);
    this._cacheOther.clear();
    this._cacheMethods = new Array(this._cacheLimit);
    this._cachePaths = new Array(this._cacheLimit);
    this._cacheSize = 0;
    this._cacheIndex = 0;
    this._compiled = true;
  }

  private _compile(): void {
    this._automata.clear();
    this._automatonGET = null;
    this._automatonWildcard = null;
    this._regexRoutes.clear();
    this._hasRegexRoutes = false;

    const groupedStringRoutes = new Map<string, RouteDef[]>();

    for (const route of this._routes) {
      if (route.path instanceof RegExp) {
        const entry: RegexRouteDef = {
          regex: route.path,
          handler: route.handler,
          store: route.store,
          minDepth: splitPath(extractRegexLiteralPrefix(route.path)).length,
          order: route.order,
        };
        const list = this._regexRoutes.get(route.method);
        if (list) list.push(entry);
        else this._regexRoutes.set(route.method, [entry]);
        continue;
      }
      const list = groupedStringRoutes.get(route.method);
      if (list) list.push(route);
      else groupedStringRoutes.set(route.method, [route]);
    }

    for (const [method, regexList] of this._regexRoutes) {
      regexList.sort((a, b) => a.order - b.order);
      this._regexRoutes.set(method, regexList);
    }
    this._hasRegexRoutes = this._regexRoutes.size > 0;

    for (const [method, defs] of groupedStringRoutes) {
      this._automata.set(method, this._compileMethod(defs));
    }
    this._automatonGET = this._automata.get('GET') ?? null;
    this._automatonWildcard = this._automata.get('*') ?? null;
  }

  private _compileMethod(defs: RouteDef[]): MethodAutomaton {
    const root = new BuildState();
    const accepts: AcceptRecord[] = [];

    for (const def of defs) {
      const variants = tokenizePathPattern(def.path as string);
      for (const segments of variants) {
        let node = root;
        for (const segment of segments) {
          if (segment.kind === 'static') {
            let next = node.staticEdges.get(segment.value);
            if (!next) {
              next = new BuildState();
              node.staticEdges.set(segment.value, next);
            }
            node = next;
            continue;
          }

          const validatorId = segment.kind === 'param' ? this._getValidatorId(segment.pattern) : 0;
          const score = scoreEdge(segment.kind, this._validators[validatorId]?.kind ?? 'none');
          const existing = node.dynEdges.find((edge) => edge.kind === segment.kind && edge.name === segment.name && edge.validatorId === validatorId);
          if (existing) {
            node = existing.next;
          } else {
            const next = new BuildState();
            node.dynEdges.push({
              kind: segment.kind,
              name: segment.name,
              validatorId,
              next,
              score,
              order: def.order,
            });
            node = next;
          }

          if (segment.kind === 'wildcard') {
            break;
          }
        }

        if (node.acceptIndex >= 0) {
          accepts[node.acceptIndex] = { handler: def.handler, store: def.store };
        } else {
          node.acceptIndex = accepts.length;
          accepts.push({ handler: def.handler, store: def.store });
        }
      }
    }

    const nodes: BuildState[] = [];
    const nodeIds = new Map<BuildState, number>();
    const stack: BuildState[] = [root];

    while (stack.length) {
      const node = stack.pop() as BuildState;
      if (nodeIds.has(node)) continue;
      const nodeId = nodes.length;
      nodeIds.set(node, nodeId);
      nodes.push(node);
      for (const next of node.staticEdges.values()) {
        stack.push(next);
      }
      for (const edge of node.dynEdges) {
        stack.push(edge.next);
      }
    }

    const stateCount = nodes.length;
    const stateStaticOffset = new Int32Array(stateCount);
    const stateStaticCount = new Int32Array(stateCount);
    const stateDynOffset = new Int32Array(stateCount);
    const stateDynCount = new Int32Array(stateCount);
    const stateAcceptIndex = new Int32Array(stateCount);
    stateAcceptIndex.fill(-1);

    const literals: string[] = [];
    const literalIds = new Map<string, number>();
    const paramNames: string[] = [];
    const paramNameIds = new Map<string, number>();

    const staticLiteralIds: number[] = [];
    const staticNext: number[] = [];
    const dynKind: number[] = [];
    const dynNameIds: number[] = [];
    const dynValidatorIds: number[] = [];
    const dynNext: number[] = [];
    const stateStaticMaps: Array<Record<string, number> | null> = new Array(stateCount);

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      stateAcceptIndex[i] = node.acceptIndex;

      stateStaticOffset[i] = staticLiteralIds.length;
      stateStaticCount[i] = node.staticEdges.size;
      if (node.staticEdges.size > 0) {
        const staticMap = Object.create(null) as Record<string, number>;
        stateStaticMaps[i] = staticMap;
        for (const [literal, nextNode] of node.staticEdges) {
          staticMap[literal] = nodeIds.get(nextNode) as number;
        }
      } else {
        stateStaticMaps[i] = null;
      }
      for (const [literal, nextNode] of node.staticEdges) {
        let literalId = literalIds.get(literal);
        if (literalId === undefined) {
          literalId = literals.length;
          literals.push(literal);
          literalIds.set(literal, literalId);
        }
        staticLiteralIds.push(literalId);
        staticNext.push(nodeIds.get(nextNode) as number);
      }

      const orderedDynEdges = [...node.dynEdges].sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.order - b.order;
      });

      stateDynOffset[i] = dynKind.length;
      stateDynCount[i] = orderedDynEdges.length;
      for (const edge of orderedDynEdges) {
        dynKind.push(edge.kind === 'wildcard' ? DYN_WILDCARD : DYN_PARAM);

        let nameId = paramNameIds.get(edge.name);
        if (nameId === undefined) {
          nameId = paramNames.length;
          paramNames.push(edge.name);
          paramNameIds.set(edge.name, nameId);
        }

        dynNameIds.push(nameId);
        dynValidatorIds.push(edge.validatorId);
        dynNext.push(nodeIds.get(edge.next) as number);
      }
    }

    return {
      stateStaticOffset,
      stateStaticCount,
      stateDynOffset,
      stateDynCount,
      stateAcceptIndex,
      staticLiteralIds: Int32Array.from(staticLiteralIds),
      staticNext: Int32Array.from(staticNext),
      dynKind: Uint8Array.from(dynKind),
      dynNameIds: Int32Array.from(dynNameIds),
      dynValidatorIds: Int32Array.from(dynValidatorIds),
      dynNext: Int32Array.from(dynNext),
      stateStaticMaps,
      literals,
      paramNames,
      accepts,
    };
  }

  private _getValidatorId(pattern?: string): number {
    if (!pattern) return 0;
    const cached = this._validatorCache.get(pattern);
    if (cached !== undefined) return cached;

    const trimmed = pattern.trim();
    let entry: ValidatorEntry;

    if (trimmed.startsWith('#')) {
      const alias = trimmed.slice(1);
      const aliasCode = VALIDATOR_ALIAS_CODES[alias as keyof typeof VALIDATOR_ALIAS_CODES];
      if (aliasCode === undefined) {
        throw new Error(`[automaton-router] Unknown validator alias: ${trimmed}`);
      }
      switch (aliasCode) {
        case VAL_INT:
          entry = { kind: 'int', code: VAL_INT };
          break;
        case VAL_ALPHA:
          entry = { kind: 'alpha', code: VAL_ALPHA };
          break;
        case VAL_SLUG:
          entry = { kind: 'slug', code: VAL_SLUG };
          break;
        case VAL_LOCALE:
          entry = { kind: 'locale', code: VAL_LOCALE };
          break;
        case VAL_UUID:
          entry = { kind: 'uuid', code: VAL_UUID };
          break;
        default:
          throw new Error(`[automaton-router] Unsupported validator alias code: ${aliasCode}`);
      }
      const id = this._validators.length;
      this._validators.push(entry);
      this._validatorCache.set(pattern, id);
      return id;
    }

    if (trimmed === '\\d+' || trimmed === '[0-9]+' || trimmed === '\\d{1,}') {
      entry = { kind: 'int', code: VAL_INT };
    } else if (trimmed === '[a-zA-Z]+' || trimmed === '[A-Za-z]+') {
      entry = { kind: 'alpha', code: VAL_ALPHA };
    } else if (trimmed === '[a-z0-9-]+' || trimmed === '[A-Za-z0-9-]+') {
      entry = { kind: 'slug', code: VAL_SLUG };
    } else if (trimmed === '[a-z]{2}-[A-Z]{2}') {
      entry = { kind: 'locale', code: VAL_LOCALE };
    } else if (
      trimmed === '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}' ||
      trimmed === '[0-9a-fA-F-]{36}'
    ) {
      entry = { kind: 'uuid', code: VAL_UUID };
    } else {
      const regex = new RegExp(`^${trimmed}$`);
      entry = { kind: 'regex', code: VAL_REGEX, regex };
    }

    const id = this._validators.length;
    this._validators.push(entry);
    this._validatorCache.set(pattern, id);
    return id;
  }

  private _cacheSet(method: string, path: string, value: RouteMatch | null): void {
    if (this._cacheLimit <= 0) return;
    const methodCacheEntry = this._getOrCreateMethodCache(method);
    if (methodCacheEntry[path] !== undefined) {
      methodCacheEntry[path] = value;
      return;
    }
    if (this._cacheSize < this._cacheLimit) {
      const writeIndex = this._cacheSize;
      this._cacheMethods[writeIndex] = method;
      this._cachePaths[writeIndex] = path;
      this._cacheSize += 1;
    } else {
      const oldestMethod = this._cacheMethods[this._cacheIndex];
      const oldestPath = this._cachePaths[this._cacheIndex];
      if (oldestMethod !== undefined) {
        const oldCache = this._getMethodCache(oldestMethod);
        if (oldCache) {
          delete oldCache[oldestPath];
        }
      }
      this._cacheMethods[this._cacheIndex] = method;
      this._cachePaths[this._cacheIndex] = path;
      let next = this._cacheIndex + 1;
      if (next === this._cacheLimit) next = 0;
      this._cacheIndex = next;
    }
    methodCacheEntry[path] = value;
  }

  private _cacheSetGET(path: string, value: RouteMatch | null): void {
    if (this._cacheLimit <= 0) return;
    if (this._cacheGET[path] !== undefined) {
      this._cacheGET[path] = value;
      return;
    }
    if (this._cacheSize < this._cacheLimit) {
      const writeIndex = this._cacheSize;
      this._cacheMethods[writeIndex] = 'GET';
      this._cachePaths[writeIndex] = path;
      this._cacheSize += 1;
      this._cacheGET[path] = value;
      return;
    }
    const evictIndex = this._cacheIndex;
    const oldestMethod = this._cacheMethods[evictIndex];
    const oldestPath = this._cachePaths[evictIndex];
    if (oldestMethod === 'GET') {
      delete this._cacheGET[oldestPath];
    } else if (oldestMethod !== undefined) {
      const oldCache = this._cacheOther.get(oldestMethod);
      if (oldCache) delete oldCache[oldestPath];
    }
    this._cacheMethods[evictIndex] = 'GET';
    this._cachePaths[evictIndex] = path;
    let next = evictIndex + 1;
    if (next === this._cacheLimit) next = 0;
    this._cacheIndex = next;
    this._cacheGET[path] = value;
  }

  private _getMethodCache(method: string): Record<string, RouteMatch | null> | undefined {
    if (method === 'GET') return this._cacheGET;
    return this._cacheOther.get(method);
  }

  private _getOrCreateMethodCache(method: string): Record<string, RouteMatch | null> {
    if (method === 'GET') return this._cacheGET;
    const existing = this._cacheOther.get(method);
    if (existing) return existing;
    const created = Object.create(null) as Record<string, RouteMatch | null>;
    this._cacheOther.set(method, created);
    return created;
  }
}

export function createAutomatonRouter(): AutomatonRouter {
  return new AutomatonRouter();
}

function scoreEdge(kind: 'param' | 'wildcard', validatorKind: ValidatorEntry['kind']): number {
  if (kind === 'wildcard') return -100;
  switch (validatorKind) {
    case 'int':
      return 40;
    case 'uuid':
      return 35;
    case 'locale':
      return 30;
    case 'alpha':
      return 25;
    case 'slug':
      return 20;
    case 'regex':
      return 10;
    default:
      return 0;
  }
}

function normalizeMethod(method: string): string {
  if (method == null) return '*';
  if (typeof method === 'string') {
    const cached = methodCache[method];
    if (cached !== undefined) return cached;
    const value = method.trim();
    const normalized = value === '' ? '*' : value.toUpperCase();
    methodCache[method] = normalized;
    return normalized;
  }
  const value = String(method).trim();
  return value === '' ? '*' : value.toUpperCase();
}

function normalizePath(path: string): string {
  if (path == null) return '/';
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
  if (start < path.length) segments.push(path.slice(start));
  return segments;
}

function buildRestFromPositions(
  path: string,
  starts: number[],
  ends: number[],
  fromIndex: number,
  depth: number,
): string {
  if (fromIndex >= depth) return '';
  let rest = path.slice(starts[fromIndex], ends[fromIndex]);
  for (let i = fromIndex + 1; i < depth; i += 1) {
    rest += '/';
    rest += path.slice(starts[i], ends[i]);
  }
  return rest;
}

function tokenizePathPattern(path: string): SegmentToken[][] {
  const normalized = normalizePath(path);
  if (normalized === '/') return [[]];

  const rawSegments = normalized.split('/').slice(1);
  let variants: SegmentToken[][] = [[]];

  for (const rawSegment of rawSegments) {
    if (!rawSegment) continue;

    if (rawSegment[0] === '(' && rawSegment[rawSegment.length - 1] === ')') {
      const choices = rawSegment.slice(1, -1).split('|');
      const nextVariants: SegmentToken[][] = [];
      for (const variant of variants) {
        for (const choice of choices) {
          nextVariants.push([...variant, { kind: 'static', value: choice }]);
        }
      }
      variants = nextVariants;
      continue;
    }

    const param = parseParamSegment(rawSegment);
    if (!param) {
      for (const variant of variants) {
        variant.push({ kind: 'static', value: rawSegment });
      }
      continue;
    }

    if (param.optional) {
      const nextVariants: SegmentToken[][] = [];
      for (const variant of variants) {
        nextVariants.push([...variant]);
        if (param.wildcard) {
          nextVariants.push([...variant, { kind: 'wildcard', name: param.name }]);
        } else {
          nextVariants.push([...variant, { kind: 'param', name: param.name, pattern: param.pattern }]);
        }
      }
      variants = nextVariants;
      continue;
    }

    for (const variant of variants) {
      if (param.wildcard) variant.push({ kind: 'wildcard', name: param.name });
      else variant.push({ kind: 'param', name: param.name, pattern: param.pattern });
    }
  }

  return variants;
}

function parseParamSegment(segment: string): { name: string; pattern?: string; wildcard?: boolean; optional?: boolean } | null {
  if (!segment.startsWith(':')) return null;

  const optional = segment.endsWith('?');
  const core = optional ? segment.slice(0, -1) : segment;

  if (core.endsWith('*')) {
    return {
      name: core.slice(1, -1),
      wildcard: true,
      optional,
    };
  }

  const open = core.indexOf('(');
  if (open === -1) {
    const aliasIndex = core.indexOf('#');
    if (aliasIndex === -1) {
      return { name: core.slice(1), optional };
    }
    return {
      name: core.slice(1, aliasIndex),
      pattern: `#${core.slice(aliasIndex + 1)}`,
      optional,
    };
  }

  const close = core.lastIndexOf(')');
  if (close <= open) {
    return { name: core.slice(1), optional };
  }

  return {
    name: core.slice(1, open),
    pattern: core.slice(open + 1, close),
    optional,
  };
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

function isIntSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function isAlphaSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);
    const upper = code >= 65 && code <= 90;
    const lower = code >= 97 && code <= 122;
    if (!upper && !lower) return false;
  }
  return true;
}

function isSlugSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);
    const num = code >= 48 && code <= 57;
    const lower = code >= 97 && code <= 122;
    const upper = code >= 65 && code <= 90;
    const dash = code === 45;
    if (!num && !lower && !upper && !dash) return false;
  }
  return true;
}

function isLocaleSegment(segment: string): boolean {
  if (segment.length !== 5) return false;
  const c0 = segment.charCodeAt(0);
  const c1 = segment.charCodeAt(1);
  const c2 = segment.charCodeAt(2);
  const c3 = segment.charCodeAt(3);
  const c4 = segment.charCodeAt(4);
  return c0 >= 97 && c0 <= 122 && c1 >= 97 && c1 <= 122 && c2 === 45 && c3 >= 65 && c3 <= 90 && c4 >= 65 && c4 <= 90;
}

function isUuidSegment(segment: string): boolean {
  if (segment.length !== 36) return false;
  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (code !== 45) return false;
      continue;
    }
    const num = code >= 48 && code <= 57;
    const lower = code >= 97 && code <= 102;
    const upper = code >= 65 && code <= 70;
    if (!num && !lower && !upper) return false;
  }
  return true;
}
