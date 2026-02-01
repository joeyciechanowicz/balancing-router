import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const { createRouter } = require(resolve(root, 'dist', 'index.js'));

const routeFixtures = [
  ['GET', '/users', () => {}],
  ['GET', '/users/:id', () => {}],
  ['GET', '/users/:id/settings', () => {}],
  ['GET', '/assets/:path*', () => {}],
  ['GET', '/health', () => {}],
  ['GET', '/search/:query', () => {}],
  ['GET', '/products', () => {}],
  ['GET', '/products/:productId', () => {}],
  ['GET', '/products/:productId/reviews', () => {}],
  ['GET', '/categories/:categoryId/products', () => {}],
  ['GET', '/orders/:orderId', () => {}],
  ['GET', '/orders/:orderId/items/:itemId', () => {}],
  ['GET', '/blog/:year/:month/:slug', () => {}],
  ['GET', '/api/v1/users/:id', () => {}],
  ['GET', '/api/v2/users/:id/settings', () => {}],
  ['POST', '/users', () => {}],
  ['POST', '/orders', () => {}],
  ['PUT', '/products/:productId', () => {}],
  ['PATCH', '/users/:id', () => {}],
  ['DELETE', '/users/:id', () => {}],
  ['DELETE', '/orders/:orderId', () => {}],
];

const lookups = [];
const userIds = ['1', '42', '123', '999', '1001'];
const productIds = ['10', '200', '1234', '7777', '9090'];
const orderIds = ['500', '600', '700', '800'];
const itemIds = ['1', '2', '3'];
const slugs = ['hello-world', 'node-routing', 'perf-tips'];
const months = ['01', '02', '12'];

lookups.push(['GET', '/users']);
for (const id of userIds) {
  lookups.push(['GET', `/users/${id}`]);
  lookups.push(['GET', `/users/${id}/settings`]);
  lookups.push(['GET', `/api/v1/users/${id}`]);
  lookups.push(['GET', `/api/v2/users/${id}/settings`]);
  lookups.push(['PATCH', `/users/${id}`]);
  lookups.push(['DELETE', `/users/${id}`]);
}
lookups.push(['GET', '/assets/css/app.css']);
lookups.push(['GET', '/assets/js/app.js']);
lookups.push(['GET', '/assets/img/logo.png']);
lookups.push(['GET', '/health']);
lookups.push(['GET', '/search/node']);
lookups.push(['GET', '/search/router']);
lookups.push(['POST', '/users']);
lookups.push(['POST', '/orders']);

lookups.push(['GET', '/products']);
for (const id of productIds) {
  lookups.push(['GET', `/products/${id}`]);
  lookups.push(['GET', `/products/${id}/reviews`]);
  lookups.push(['PUT', `/products/${id}`]);
}

for (const id of orderIds) {
  lookups.push(['GET', `/orders/${id}`]);
  lookups.push(['DELETE', `/orders/${id}`]);
  for (const itemId of itemIds) {
    lookups.push(['GET', `/orders/${id}/items/${itemId}`]);
  }
}

for (const categoryId of ['books', 'tech', 'home']) {
  lookups.push(['GET', `/categories/${categoryId}/products`]);
}

for (const year of ['2023', '2024']) {
  for (const month of months) {
    for (const slug of slugs) {
      lookups.push(['GET', `/blog/${year}/${month}/${slug}`]);
    }
  }
}

const router = createRouter();
for (const [method, path, handler] of routeFixtures) {
  router.on(method, path, handler);
}
router.on('GET', /^\/api\/v\d+\/health$/, () => {});

const iterations = Number(process.env.PROFILE_ITERS ?? 200000);
for (let i = 0; i < iterations; i += 1) {
  for (let j = 0; j < lookups.length; j += 1) {
    const entry = lookups[j];
    router.find(entry[0], entry[1]);
  }
}
