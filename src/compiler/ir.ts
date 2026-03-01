import { parseRoutePattern } from './parser';
import type { RouteAst, RouteIr, RouteIrVariant, SegmentIr } from './types';

export function buildRouteIrFromPattern(pattern: string): RouteIr {
  return buildRouteIr(parseRoutePattern(pattern));
}

export function buildRouteIr(routeAst: RouteAst): RouteIr {
  let variants: RouteIrVariant[] = [{ segments: [] }];

  for (const segment of routeAst.segments) {
    switch (segment.kind) {
      case 'static': {
        variants = appendToAll(variants, { kind: 'static', value: segment.value });
        break;
      }
      case 'group': {
        const next: RouteIrVariant[] = [];
        for (const variant of variants) {
          for (const alternative of segment.alternatives) {
            next.push({
              segments: [...variant.segments, { kind: 'static', value: alternative }],
            });
          }
        }
        variants = next;
        break;
      }
      case 'param': {
        if (segment.optional) {
          const withParam = appendToAll(variants, { kind: 'param', name: segment.name, pattern: segment.pattern });
          variants = [...variants, ...withParam];
        } else {
          variants = appendToAll(variants, { kind: 'param', name: segment.name, pattern: segment.pattern });
        }
        break;
      }
      case 'wildcard': {
        variants = appendToAll(variants, { kind: 'wildcard', name: segment.name });
        break;
      }
      default: {
        const exhausted: never = segment;
        throw new Error(`Unhandled segment kind: ${String(exhausted)}`);
      }
    }
  }

  return {
    source: routeAst.normalized,
    variants,
  };
}

function appendToAll(variants: RouteIrVariant[], segment: SegmentIr): RouteIrVariant[] {
  const next: RouteIrVariant[] = new Array(variants.length);
  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i];
    next[i] = {
      segments: [...variant.segments, segment],
    };
  }
  return next;
}

