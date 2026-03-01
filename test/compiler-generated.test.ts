import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneratedRouter } from '../src/compiler/generated-router';
import { createIrInterpreterRouter } from '../src/compiler/interpreter';

const noop = () => {};

test('generated: matches static, param, optional and wildcard routes', () => {
  const router = createGeneratedRouter({ mode: 'generated' });
  router.on('GET', '/users', noop);
  router.on('GET', '/users/:id(\\d+)', noop);
  router.on('GET', '/assets/:path*', noop);
  router.on('GET', '/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved', noop);

  assert.ok(router.find('GET', '/users'));
  assert.ok(router.find('GET', '/users/123'));
  assert.equal(router.find('GET', '/users/abc'), null);
  assert.deepEqual({ ...router.find('GET', '/assets/a/b/c')!.params }, { path: 'a/b/c' });
  assert.ok(router.find('GET', '/catalog/saved'));
  assert.ok(router.find('GET', '/catalog/en-US/saved'));
  assert.equal(router.find('GET', '/catalog/en-us/saved'), null);
});

test('generated: method-specific route wins over wildcard route', () => {
  const router = createGeneratedRouter({ mode: 'generated' });
  const anyHandler = () => 'any';
  const getHandler = () => 'get';
  router.on('*', '/status', anyHandler);
  router.on('GET', '/status', getHandler);
  assert.equal(router.find('GET', '/status')?.handler, getHandler);
  assert.equal(router.find('POST', '/status')?.handler, anyHandler);
});

test('generated: interpreter mode parity with generated mode', async () => {
  const generated = createGeneratedRouter({ mode: 'generated' });
  const interpreted = createGeneratedRouter({ mode: 'interpreted' });
  const baseline = createIrInterpreterRouter();

  const module = await import('../bench/routes-generic.mjs');
  const routes: Array<{ path: string; generateUrl: (rng: () => number) => string }> = module.routes;
  const maxRoutes = Math.min(routes.length, 40);
  for (let i = 0; i < maxRoutes; i += 1) {
    const route = routes[i];
    const handler = ((index: number) => () => index)(i);
    generated.on('GET', route.path, handler);
    interpreted.on('GET', route.path, handler);
    baseline.on('GET', route.path, handler);
  }

  const rng = mulberry32(12345);
  for (let i = 0; i < maxRoutes; i += 1) {
    const route = routes[i];
    for (let sample = 0; sample < 3; sample += 1) {
      const url = route.generateUrl(rng);
      const gen = generated.find('GET', url);
      const intr = interpreted.find('GET', url);
      const base = baseline.find('GET', url);

      assert.equal(Boolean(gen), Boolean(base), `generated presence mismatch on ${url}`);
      assert.equal(Boolean(intr), Boolean(base), `interpreted presence mismatch on ${url}`);
      assert.equal(gen?.handler, base?.handler, `generated handler mismatch on ${url}`);
      assert.equal(intr?.handler, base?.handler, `interpreted handler mismatch on ${url}`);
      assert.deepEqual({ ...(gen?.params ?? {}) }, { ...(base?.params ?? {}) }, `generated params mismatch on ${url}`);
      assert.deepEqual({ ...(intr?.params ?? {}) }, { ...(base?.params ?? {}) }, `interpreted params mismatch on ${url}`);
    }
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

