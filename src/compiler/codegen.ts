import type { RouteIrVariant } from './types';

export type GeneratedMatcher = (segments: string[]) => Record<string, string> | null;

const EMPTY_PARAMS = Object.create(null) as Record<string, string>;

export function generateVariantMatcher(variant: RouteIrVariant): GeneratedMatcher {
  const regexList: Array<RegExp | undefined> = [];
  const lines: string[] = [];
  lines.push('let params = null;');
  lines.push('let i = 0;');

  for (let idx = 0; idx < variant.segments.length; idx += 1) {
    const segment = variant.segments[idx];
    if (segment.kind === 'static') {
      lines.push(`if (i >= segments.length || segments[i] !== ${JSON.stringify(segment.value)}) return null;`);
      lines.push('i += 1;');
      continue;
    }
    if (segment.kind === 'param') {
      const regexId = regexList.length;
      regexList.push(segment.pattern ? new RegExp(`^${segment.pattern}$`) : undefined);
      lines.push('if (i >= segments.length) return null;');
      lines.push('const value = segments[i];');
      lines.push(`if (REGEX[${regexId}] && !REGEX[${regexId}].test(value)) return null;`);
      lines.push('if (params === null) params = Object.create(null);');
      lines.push(`params[${JSON.stringify(segment.name)}] = value;`);
      lines.push('i += 1;');
      continue;
    }
    lines.push('const rest = i < segments.length ? segments.slice(i).join("/") : "";');
    lines.push('if (params === null) params = Object.create(null);');
    lines.push(`params[${JSON.stringify(segment.name)}] = rest;`);
    lines.push('i = segments.length;');
  }

  lines.push('if (i !== segments.length) return null;');
  lines.push('return params === null ? EMPTY_PARAMS : params;');

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'EMPTY_PARAMS',
    'REGEX',
    `return function generatedMatcher(segments) { ${lines.join('\n')} };`,
  ) as (empty: Record<string, string>, regex: Array<RegExp | undefined>) => GeneratedMatcher;

  return factory(EMPTY_PARAMS, regexList);
}

