import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutePattern, RoutePatternSyntaxError } from '../src/compiler/parser';

test('parser: parses static segments', () => {
  const ast = parseRoutePattern('/users/list');
  assert.equal(ast.normalized, '/users/list');
  assert.deepEqual(ast.segments, [
    { kind: 'static', value: 'users' },
    { kind: 'static', value: 'list' },
  ]);
});

test('parser: parses group + optional regex param', () => {
  const ast = parseRoutePattern('/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved');
  assert.equal(ast.normalized, '/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved');
  assert.deepEqual(ast.segments, [
    { kind: 'group', alternatives: ['catalog', 'portal'] },
    { kind: 'param', name: 'locale', pattern: '[a-z]{2}-[A-Z]{2}', optional: true },
    { kind: 'static', value: 'saved' },
  ]);
});

test('parser: parses named wildcard and unnamed wildcard', () => {
  const named = parseRoutePattern('/assets/:path*');
  assert.deepEqual(named.segments, [
    { kind: 'static', value: 'assets' },
    { kind: 'wildcard', name: 'path' },
  ]);

  const unnamed = parseRoutePattern('/files/*');
  assert.deepEqual(unnamed.segments, [
    { kind: 'static', value: 'files' },
    { kind: 'wildcard', name: '*' },
  ]);
});

test('parser: normalizes routes without leading slash', () => {
  const ast = parseRoutePattern('status');
  assert.equal(ast.normalized, '/status');
  assert.deepEqual(ast.segments, [{ kind: 'static', value: 'status' }]);
});

test('parser: throws actionable error on empty segment', () => {
  assert.throws(
    () => parseRoutePattern('/users//id'),
    (error: unknown) =>
      error instanceof RoutePatternSyntaxError &&
      error.message.includes('Empty path segment is not allowed') &&
      error.message.includes('index 7'),
  );
});

test('parser: throws actionable error on missing param name', () => {
  assert.throws(
    () => parseRoutePattern('/:'),
    (error: unknown) =>
      error instanceof RoutePatternSyntaxError &&
      error.message.includes('Parameter name is missing') &&
      error.message.includes('index 2'),
  );
});

test('parser: throws actionable error on unclosed regex', () => {
  assert.throws(
    () => parseRoutePattern('/:id(\\d+'),
    (error: unknown) =>
      error instanceof RoutePatternSyntaxError &&
      error.message.includes('Unclosed parenthesis group'),
  );
});

test('parser: throws actionable error on unknown parameter suffix', () => {
  assert.throws(
    () => parseRoutePattern('/:id+'),
    (error: unknown) =>
      error instanceof RoutePatternSyntaxError &&
      error.message.includes('Unexpected token in parameter segment') &&
      error.message.includes('index 4'),
  );
});

test('parser: throws actionable error on empty group alternative', () => {
  assert.throws(
    () => parseRoutePattern('/(catalog|)/saved'),
    (error: unknown) =>
      error instanceof RoutePatternSyntaxError &&
      error.message.includes('Group alternative cannot be empty'),
  );
});

