import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouterParser } from '../src/index';

test('setup: compiles generated router from added routes', () => {
  const getSaved = () => 'saved';
  const postSaved = () => 'post-saved';
  const store = { from: 'setup' };

  const setup = createRouterParser({ mode: 'generated' });
  setup.add('GET', '/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved', getSaved, store);
  setup.add('POST', '/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved', postSaved);
  const router = setup.compile();

  const getMatch = router.find('GET', '/catalog/en-US/saved');
  assert.equal(getMatch?.handler, getSaved);
  assert.deepEqual({ ...getMatch?.params }, { locale: 'en-US' });
  assert.equal(getMatch?.store, store);

  const postMatch = router.find('POST', '/portal/saved');
  assert.equal(postMatch?.handler, postSaved);
  assert.deepEqual({ ...postMatch?.params }, {});
});

test('setup: supports method arrays and wildcard fallback after compile', () => {
  const setup = createRouterParser({ mode: 'generated' });
  const exact = () => 'exact';
  const any = () => 'any';

  setup.add(['GET', 'POST'], '/status', exact);
  setup.add('*', '/health', any);
  const router = setup.compile();

  assert.equal(router.find('GET', '/status')?.handler, exact);
  assert.equal(router.find('POST', '/status')?.handler, exact);
  assert.equal(router.find('PUT', '/status'), null);
  assert.equal(router.find('DELETE', '/health')?.handler, any);
});

