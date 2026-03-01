import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutePattern } from '../src/compiler/parser';
import { buildRouteIr, buildRouteIrFromPattern } from '../src/compiler/ir';

test('ir: expands group alternatives', () => {
  const ir = buildRouteIrFromPattern('/(catalog|portal)/saved');
  assert.equal(ir.source, '/(catalog|portal)/saved');
  assert.equal(ir.variants.length, 2);
  assert.deepEqual(ir.variants[0], {
    segments: [
      { kind: 'static', value: 'catalog' },
      { kind: 'static', value: 'saved' },
    ],
  });
  assert.deepEqual(ir.variants[1], {
    segments: [
      { kind: 'static', value: 'portal' },
      { kind: 'static', value: 'saved' },
    ],
  });
});

test('ir: expands optional params into with/without variants', () => {
  const ir = buildRouteIrFromPattern('/users/:id?');
  assert.equal(ir.variants.length, 2);
  assert.deepEqual(ir.variants[0], {
    segments: [{ kind: 'static', value: 'users' }],
  });
  assert.deepEqual(ir.variants[1], {
    segments: [
      { kind: 'static', value: 'users' },
      { kind: 'param', name: 'id', pattern: undefined },
    ],
  });
});

test('ir: handles combined groups and optional params deterministically', () => {
  const ir = buildRouteIrFromPattern('/(a|b)/:id?/x');
  assert.equal(ir.variants.length, 4);
  assert.deepEqual(ir.variants, [
    {
      segments: [
        { kind: 'static', value: 'a' },
        { kind: 'static', value: 'x' },
      ],
    },
    {
      segments: [
        { kind: 'static', value: 'b' },
        { kind: 'static', value: 'x' },
      ],
    },
    {
      segments: [
        { kind: 'static', value: 'a' },
        { kind: 'param', name: 'id', pattern: undefined },
        { kind: 'static', value: 'x' },
      ],
    },
    {
      segments: [
        { kind: 'static', value: 'b' },
        { kind: 'param', name: 'id', pattern: undefined },
        { kind: 'static', value: 'x' },
      ],
    },
  ]);
});

test('ir: preserves wildcard segments', () => {
  const ast = parseRoutePattern('/assets/:path*');
  const ir = buildRouteIr(ast);
  assert.deepEqual(ir.variants, [
    {
      segments: [
        { kind: 'static', value: 'assets' },
        { kind: 'wildcard', name: 'path' },
      ],
    },
  ]);
});

