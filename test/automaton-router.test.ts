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
