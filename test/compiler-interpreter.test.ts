import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomatonRouter } from '../src/index';
import { createIrInterpreterRouter } from '../src/compiler/interpreter';

const noop = () => {};

test('interpreter: matches static, params, regex params, and wildcard', () => {
  const router = createIrInterpreterRouter();
  const staticHandler = () => 'static';
  const paramHandler = () => 'param';
  const wildcardHandler = () => 'wildcard';

  router.on('GET', '/users', staticHandler);
  router.on('GET', '/users/:id(\\d+)', paramHandler);
  router.on('GET', '/assets/:path*', wildcardHandler);

  const staticMatch = router.find('GET', '/users');
  assert.equal(staticMatch?.handler, staticHandler);

  const paramMatch = router.find('GET', '/users/42');
  assert.equal(paramMatch?.handler, paramHandler);
  assert.deepEqual({ ...paramMatch?.params }, { id: '42' });

  const wildcardMatch = router.find('GET', '/assets/css/app.css');
  assert.equal(wildcardMatch?.handler, wildcardHandler);
  assert.deepEqual({ ...wildcardMatch?.params }, { path: 'css/app.css' });
});

test('interpreter: supports optional params and segment groups', () => {
  const router = createIrInterpreterRouter();
  router.on('GET', '/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved', noop);

  assert.ok(router.find('GET', '/catalog/saved'));
  assert.ok(router.find('GET', '/catalog/en-US/saved'));
  assert.ok(router.find('GET', '/portal/de-DE/saved'));
  assert.equal(router.find('GET', '/portal/en-us/saved'), null);
});

test('interpreter: prefers method-specific handler over wildcard', () => {
  const router = createIrInterpreterRouter();
  const anyHandler = () => 'any';
  const getHandler = () => 'get';

  router.on('*', '/status', anyHandler);
  router.on('GET', '/status', getHandler);

  assert.equal(router.find('GET', '/status')?.handler, getHandler);
  assert.equal(router.find('POST', '/status')?.handler, anyHandler);
});

test('interpreter: differential parity with automaton on generated generic corpus urls', async () => {
  const module = await import('../bench/routes-generic.mjs');
  const routes: Array<{
    path: string;
    count: number;
    generateUrl: (rng: () => number) => string;
  }> = module.routes;

  const automaton = createAutomatonRouter();
  const interpreter = createIrInterpreterRouter();
  const seedRng = mulberry32(42);
  const maxRoutes = Math.min(routes.length, 40);

  for (let i = 0; i < maxRoutes; i += 1) {
    const route = routes[i];
    const handler = ((index: number) => () => index)(i);
    automaton.on('GET', route.path, handler);
    interpreter.on('GET', route.path, handler);
  }

  const samplesPerRoute = 3;
  for (let i = 0; i < maxRoutes; i += 1) {
    const route = routes[i];
    for (let s = 0; s < samplesPerRoute; s += 1) {
      const url = route.generateUrl(seedRng);
      const autoMatch = automaton.find('GET', url);
      const interpMatch = interpreter.find('GET', url);
      assert.equal(Boolean(interpMatch), Boolean(autoMatch), `mismatch presence for ${url}`);
      assert.equal(interpMatch?.handler, autoMatch?.handler, `mismatch handler for ${url}`);
      assert.deepEqual({ ...(interpMatch?.params ?? {}) }, { ...(autoMatch?.params ?? {}) }, `mismatch params for ${url}`);
    }
  }

  for (let i = 0; i < 20; i += 1) {
    const url = `/missing/${Math.floor(seedRng() * 1_000_000)}`;
    const autoMatch = automaton.find('GET', url);
    const interpMatch = interpreter.find('GET', url);
    assert.equal(interpMatch, autoMatch, `expected null for ${url}`);
  }
});

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

