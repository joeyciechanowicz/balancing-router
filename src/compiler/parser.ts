import type { GroupSegmentAst, ParamSegmentAst, RouteAst, SegmentAst, WildcardSegmentAst } from './types';

interface RawSegment {
  value: string;
  start: number;
}

export class RoutePatternSyntaxError extends Error {
  readonly index: number;
  readonly pattern: string;

  constructor(message: string, pattern: string, index: number) {
    super(`${message} at index ${index}`);
    this.name = 'RoutePatternSyntaxError';
    this.index = index;
    this.pattern = pattern;
  }
}

export function parseRoutePattern(pattern: string): RouteAst {
  if (typeof pattern !== 'string') {
    throw new RoutePatternSyntaxError('Route pattern must be a string', String(pattern), 0);
  }
  const normalized = normalizePath(pattern);
  const rawSegments = splitSegments(normalized);
  const segments: SegmentAst[] = rawSegments.map((segment) => parseSegment(segment.value, normalized, segment.start));
  return {
    original: pattern,
    normalized,
    segments,
  };
}

function normalizePath(path: string): string {
  if (path.length === 0) return '/';
  return path.charCodeAt(0) === 47 ? path : `/${path}`;
}

function splitSegments(path: string): RawSegment[] {
  if (path === '/') return [];

  const segments: RawSegment[] = [];
  let depth = 0;
  let escaped = false;
  let current = '';
  let segmentStart = 1;

  for (let i = 1; i < path.length; i += 1) {
    const ch = path[i];

    if (!escaped && ch === '/') {
      if (current.length === 0) {
        throw new RoutePatternSyntaxError('Empty path segment is not allowed', path, i);
      }
      segments.push({ value: current, start: segmentStart });
      current = '';
      segmentStart = i + 1;
      continue;
    }

    if (!escaped && ch === '(') depth += 1;
    if (!escaped && ch === ')') {
      depth -= 1;
      if (depth < 0) {
        throw new RoutePatternSyntaxError('Unmatched closing parenthesis', path, i);
      }
    }

    current += ch;

    if (ch === '\\' && !escaped) {
      escaped = true;
    } else {
      escaped = false;
    }
  }

  if (depth !== 0) {
    throw new RoutePatternSyntaxError('Unclosed parenthesis group', path, path.length - 1);
  }

  if (current.length > 0) {
    segments.push({ value: current, start: segmentStart });
  } else if (path[path.length - 1] === '/') {
    throw new RoutePatternSyntaxError('Trailing slash creates an empty segment', path, path.length - 1);
  }

  return segments;
}

function parseSegment(segment: string, pattern: string, segmentStart: number): SegmentAst {
  if (segment === '*') {
    return { kind: 'wildcard', name: '*' };
  }
  if (segment[0] === ':') {
    return parseParamSegment(segment, pattern, segmentStart);
  }
  if (segment[0] === '(' && segment[segment.length - 1] === ')') {
    return parseGroupSegment(segment, pattern, segmentStart);
  }
  return { kind: 'static', value: segment };
}

function parseGroupSegment(segment: string, pattern: string, segmentStart: number): GroupSegmentAst {
  const body = segment.slice(1, -1);
  if (body.length === 0) {
    throw new RoutePatternSyntaxError('Group alternatives cannot be empty', pattern, segmentStart);
  }

  const alternatives = splitAlternatives(body, pattern, segmentStart + 1);
  if (alternatives.length < 2) {
    // A single-item group is syntactically valid, but does not need group semantics.
    return { kind: 'group', alternatives };
  }

  return { kind: 'group', alternatives };
}

function splitAlternatives(source: string, pattern: string, sourceStart: number): string[] {
  const alternatives: string[] = [];
  let current = '';
  let depth = 0;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (!escaped && ch === '|' && depth === 0) {
      if (current.length === 0) {
        throw new RoutePatternSyntaxError('Group alternative cannot be empty', pattern, sourceStart + i);
      }
      alternatives.push(current);
      current = '';
      continue;
    }
    if (!escaped && ch === '(') depth += 1;
    if (!escaped && ch === ')') {
      depth -= 1;
      if (depth < 0) {
        throw new RoutePatternSyntaxError('Unmatched closing parenthesis in group', pattern, sourceStart + i);
      }
    }
    current += ch;
    if (ch === '\\' && !escaped) escaped = true;
    else escaped = false;
  }

  if (depth !== 0) {
    throw new RoutePatternSyntaxError('Unclosed nested parenthesis in group', pattern, sourceStart + source.length - 1);
  }
  if (current.length === 0) {
    throw new RoutePatternSyntaxError('Group alternative cannot be empty', pattern, sourceStart + source.length - 1);
  }
  alternatives.push(current);

  return alternatives;
}

function parseParamSegment(segment: string, pattern: string, segmentStart: number): ParamSegmentAst | WildcardSegmentAst {
  let index = 1;
  let name = '';
  while (index < segment.length) {
    const code = segment.charCodeAt(index);
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    const isUnderscore = code === 95;
    if (!isUpper && !isLower && !isDigit && !isUnderscore) break;
    name += segment[index];
    index += 1;
  }

  if (name.length === 0) {
    throw new RoutePatternSyntaxError('Parameter name is missing', pattern, segmentStart + 1);
  }

  let regexPattern: string | undefined;
  if (segment[index] === '(') {
    const end = findClosingParen(segment, index, pattern, segmentStart);
    regexPattern = segment.slice(index + 1, end);
    if (regexPattern.length === 0) {
      throw new RoutePatternSyntaxError('Parameter regex cannot be empty', pattern, segmentStart + index + 1);
    }
    index = end + 1;
  }

  let optional = false;
  let wildcard = false;

  if (segment[index] === '?') {
    optional = true;
    index += 1;
  } else if (segment[index] === '*') {
    wildcard = true;
    index += 1;
  }

  if (index !== segment.length) {
    throw new RoutePatternSyntaxError('Unexpected token in parameter segment', pattern, segmentStart + index);
  }

  if (wildcard) {
    return { kind: 'wildcard', name };
  }
  return { kind: 'param', name, pattern: regexPattern, optional };
}

function findClosingParen(segment: string, openIndex: number, pattern: string, segmentStart: number): number {
  let depth = 0;
  let escaped = false;
  for (let i = openIndex; i < segment.length; i += 1) {
    const ch = segment[i];
    if (!escaped && ch === '(') depth += 1;
    if (!escaped && ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
    if (ch === '\\' && !escaped) escaped = true;
    else escaped = false;
  }
  throw new RoutePatternSyntaxError('Unclosed parameter regex', pattern, segmentStart + openIndex);
}
