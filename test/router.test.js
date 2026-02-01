'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../index.js');

const noop = () => {};

test('matches static routes', () => {
  const router = createRouter();
  router.on('GET', '/users', noop);

  const match = router.find('GET', '/users');
  assert.ok(match);
  assert.equal(match.handler, noop);
  assert.deepEqual(match.params, {});
});

test('matches param routes and captures params', () => {
  const router = createRouter();
  router.on('GET', '/users/:id', noop);

  const match = router.find('GET', '/users/42');
  assert.ok(match);
  assert.equal(match.handler, noop);
  assert.deepEqual(match.params, { id: '42' });
});

test('matches param routes with regex constraints', () => {
  const router = createRouter();
  router.on('GET', '/orders/:id(\\d+)', noop);

  const numeric = router.find('GET', '/orders/123');
  const nonNumeric = router.find('GET', '/orders/abc');
  assert.ok(numeric);
  assert.equal(numeric.handler, noop);
  assert.equal(nonNumeric, null);
});

test('matches wildcard routes', () => {
  const router = createRouter();
  router.on('GET', '/files/*', noop);

  const match = router.find('GET', '/files/a/b/c');
  assert.ok(match);
  assert.deepEqual(match.params, { '*': 'a/b/c' });
});

test('matches named wildcard routes', () => {
  const router = createRouter();
  router.on('GET', '/assets/:path*', noop);

  const match = router.find('GET', '/assets/css/app.css');
  assert.ok(match);
  assert.deepEqual(match.params, { path: 'css/app.css' });
});

test('matches regex routes', () => {
  const router = createRouter();
  router.on('GET', /^\/api\/v\d+\/health$/, noop);

  const match = router.find('GET', '/api/v2/health');
  assert.ok(match);
  assert.equal(match.handler, noop);
});

test('falls back to method wildcard', () => {
  const router = createRouter();
  router.on('*', '/health', noop);

  const match = router.find('POST', '/health');
  assert.ok(match);
  assert.equal(match.handler, noop);
});

test('rebalances dynamic children by hits', () => {
  const router = createRouter({ rebalanceInterval: 0 });
  const handlerA = () => 'a';
  const handlerB = () => 'b';

  router.on('GET', '/:first(one)', handlerA);
  router.on('GET', '/:second(two)', handlerB);

  router.find('GET', '/two');
  router.find('GET', '/two');
  router.find('GET', '/one');

  const root = router._root;
  assert.equal(root.paramChildren.length, 2);
  router.rebalance();
  assert.equal(root.paramChildren[0].node.handlers.get('GET').handler, handlerB);
});
