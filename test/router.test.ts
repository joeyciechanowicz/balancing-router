import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/index';

const noop = () => {};

test('matches static routes', () => {
  const router = createRouter();
  router.on('GET', '/users', noop);

  const match = router.find('GET', '/users');
  assert.ok(match);
  assert.equal(match.handler, noop);
  assert.equal(Object.keys(match.params).length, 0);
});

test('matches param routes and captures params', () => {
  const router = createRouter();
  router.on('GET', '/users/:id', noop);

  const match = router.find('GET', '/users/42');
  assert.ok(match);
  assert.equal(match.handler, noop);
  assert.deepEqual({ ...match.params }, { id: '42' });
});

test('matches param routes with regex constraints', () => {
  const router = createRouter();
  router.on('GET', '/orders/:id(\\d+)', noop);

  const numeric = router.find('GET', '/orders/123');
  const nonNumeric = router.find('GET', '/orders/abc');
  assert.ok(numeric);
  assert.equal(numeric?.handler, noop);
  assert.equal(nonNumeric, null);
});

test('matches wildcard routes', () => {
  const router = createRouter();
  router.on('GET', '/files/*', noop);

  const match = router.find('GET', '/files/a/b/c');
  assert.ok(match);
  assert.deepEqual({ ...match.params }, { '*': 'a/b/c' });
});

test('matches named wildcard routes', () => {
  const router = createRouter();
  router.on('GET', '/assets/:path*', noop);

  const match = router.find('GET', '/assets/css/app.css');
  assert.ok(match);
  assert.deepEqual({ ...match.params }, { path: 'css/app.css' });
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

test('returns null when no route matches', () => {
  const router = createRouter();
  router.on('GET', '/users', noop);

  const match = router.find('POST', '/missing');
  assert.equal(match, null);
});

test('supports method arrays', () => {
  const router = createRouter();
  router.on(['GET', 'POST'], '/multi', noop);

  assert.ok(router.find('GET', '/multi'));
  assert.ok(router.find('POST', '/multi'));
  assert.equal(router.find('PUT', '/multi'), null);
});

test('normalizes paths without a leading slash', () => {
  const router = createRouter();
  router.on('GET', 'status', noop);

  const match = router.find('GET', 'status');
  assert.ok(match);
  assert.equal(match.handler, noop);
});

test('normalizes method casing and trims whitespace', () => {
  const router = createRouter();
  router.on('get', '/case', noop);

  const match = router.find('  GeT  ', '/case');
  assert.ok(match);
  assert.equal(match.handler, noop);
});

test('wildcard param captures empty when path ends at wildcard node', () => {
  const router = createRouter();
  router.on('GET', '/files/:path*', noop);

  const match = router.find('GET', '/files');
  assert.ok(match);
  assert.deepEqual({ ...match.params }, { path: '' });
});

test('prioritizes static over param and wildcard', () => {
  const router = createRouter();
  const staticHandler = () => 'static';
  const paramHandler = () => 'param';
  const wildcardHandler = () => 'wildcard';

  router.on('GET', '/items/all', staticHandler);
  router.on('GET', '/items/:id', paramHandler);
  router.on('GET', '/items/:rest*', wildcardHandler);

  const match = router.find('GET', '/items/all');
  assert.equal(match?.handler, staticHandler);
});

test('regex routes do not match when pattern fails', () => {
  const router = createRouter();
  router.on('GET', /^\/api\/v\d+\/health$/, noop);

  const match = router.find('GET', '/api/vx/health');
  assert.equal(match, null);
});

test('matches root path', () => {
  const router = createRouter();
  router.on('GET', '/', noop);

  const match = router.find('GET', '/');
  assert.ok(match);
  assert.equal(match.handler, noop);
});

test('wildcard consumes the rest of the path', () => {
  const router = createRouter();
  router.on('GET', '/a/:first*/b/:second*', noop);

  const match = router.find('GET', '/a/one/two/b/three/four');
  assert.ok(match);
  assert.deepEqual({ ...match.params }, { first: 'one/two/b/three/four' });
});

test('prefers method-specific handler over method wildcard', () => {
  const router = createRouter();
  const anyHandler = () => 'any';
  const getHandler = () => 'get';

  router.on('*', '/status', anyHandler);
  router.on('GET', '/status', getHandler);

  const match = router.find('GET', '/status');
  assert.equal(match?.handler, getHandler);
});

test('stores route metadata', () => {
  const router = createRouter();
  const store = { feature: 'beta' };
  router.on('GET', '/meta', noop, store);

  const match = router.find('GET', '/meta');
  assert.ok(match);
  assert.equal(match.store, store);
});

test('routes methods on regex routes', () => {
  const router = createRouter();
  const getHandler = () => 'get';
  const postHandler = () => 'post';
  router.on('GET', /^\/api\/v\d+\/health$/, getHandler);
  router.on('POST', /^\/api\/v\d+\/health$/, postHandler);

  const getMatch = router.find('GET', '/api/v1/health');
  const postMatch = router.find('POST', '/api/v1/health');
  assert.equal(getMatch?.handler, getHandler);
  assert.equal(postMatch?.handler, postHandler);
});
