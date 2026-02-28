import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomatonRouter } from '../src/index';

const noop = () => {};

test('automaton: matches static route', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/users', noop);
  const match = router.find('GET', '/users');
  assert.ok(match);
  assert.equal(match.handler, noop);
});

test('automaton: matches param and captures', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/users/:id', noop);
  const match = router.find('GET', '/users/42');
  assert.ok(match);
  assert.deepEqual({ ...match.params }, { id: '42' });
});

test('automaton: supports regex-in-segment patterns', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/orders/:id(\\d+)', noop);
  assert.ok(router.find('GET', '/orders/123'));
  assert.equal(router.find('GET', '/orders/abc'), null);
});

test('automaton: supports optional segments', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/items/:id?', noop);
  assert.ok(router.find('GET', '/items'));
  assert.ok(router.find('GET', '/items/123'));
});

test('automaton: supports named wildcard', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/assets/:path*', noop);
  const match = router.find('GET', '/assets/css/app.css');
  assert.ok(match);
  assert.deepEqual({ ...match.params }, { path: 'css/app.css' });
});

test('automaton: falls back to method wildcard', () => {
  const router = createAutomatonRouter();
  router.on('*', '/status', noop);
  assert.ok(router.find('POST', '/status'));
});

test('automaton: supports full regex routes', () => {
  const router = createAutomatonRouter();
  router.on('GET', /^\/api\/v\d+\/health$/, noop);
  assert.ok(router.find('GET', '/api/v2/health'));
  assert.equal(router.find('GET', '/api/vx/health'), null);
});

test('automaton: normalizes method and path', () => {
  const router = createAutomatonRouter();
  router.on('get', 'status', noop);
  assert.ok(router.find('  GeT ', 'status'));
});

test('automaton: supports custom alias validators', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/users/:id#int', noop);
  assert.ok(router.find('GET', '/users/123'));
  assert.equal(router.find('GET', '/users/abc'), null);
});

test('automaton: supports alpha alias validator', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/name/:value#alpha', noop);
  assert.ok(router.find('GET', '/name/Alice'));
  assert.equal(router.find('GET', '/name/alice-1'), null);
});

test('automaton: supports slug alias validator', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/post/:value#slug', noop);
  assert.ok(router.find('GET', '/post/hello-world-2'));
  assert.equal(router.find('GET', '/post/hello_world'), null);
});

test('automaton: supports locale alias validator', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/locale/:value#locale', noop);
  assert.ok(router.find('GET', '/locale/en-US'));
  assert.equal(router.find('GET', '/locale/en-us'), null);
});

test('automaton: supports uuid alias validator', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/id/:value#uuid', noop);
  assert.ok(router.find('GET', '/id/550e8400-e29b-41d4-a716-446655440000'));
  assert.equal(router.find('GET', '/id/not-a-uuid'), null);
});

test('automaton: supports optional alias segments', () => {
  const router = createAutomatonRouter();
  router.on('GET', '/users/:id#int?', noop);
  assert.ok(router.find('GET', '/users'));
  assert.ok(router.find('GET', '/users/123'));
  assert.equal(router.find('GET', '/users/abc'), null);
});

test('automaton: throws on unknown alias', () => {
  const router = createAutomatonRouter();
  assert.throws(
    () => router.on('GET', '/users/:id#doesnotexist', noop).find('GET', '/users/1'),
    /Unknown validator alias/,
  );
});

test('automaton: prioritizes static over param and wildcard', () => {
  const router = createAutomatonRouter();
  const staticHandler = () => 'static';
  const paramHandler = () => 'param';
  const wildcardHandler = () => 'wildcard';
  router.on('GET', '/items/all', staticHandler);
  router.on('GET', '/items/:id', paramHandler);
  router.on('GET', '/items/:rest*', wildcardHandler);
  assert.equal(router.find('GET', '/items/all')?.handler, staticHandler);
});

test('automaton: prefers method-specific over wildcard method', () => {
  const router = createAutomatonRouter();
  const anyHandler = () => 'any';
  const getHandler = () => 'get';
  router.on('*', '/status', anyHandler);
  router.on('GET', '/status', getHandler);
  assert.equal(router.find('GET', '/status')?.handler, getHandler);
});

test('automaton: prefers concrete route over matching regex route', () => {
  const router = createAutomatonRouter();
  const regexHandler = () => 'regex';
  const concreteHandler = () => 'concrete';
  router.on('GET', /^\/users\/\d+$/, regexHandler);
  router.on('GET', '/users/:id#int', concreteHandler);
  assert.equal(router.find('GET', '/users/42')?.handler, concreteHandler);
});
