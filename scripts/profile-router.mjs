import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { routes } from '../bench/routes-generic.mjs';

const require = createRequire(import.meta.url);
const root = process.cwd();
const routerModule = require(resolve(root, 'dist', 'index.js'));
const routerFactoryName = process.env.PROFILE_ROUTER_FACTORY || 'createRouter';
const createRouter = routerModule[routerFactoryName];
if (typeof createRouter !== 'function') {
  throw new Error(`Unknown router factory: ${routerFactoryName}`);
}

function createRng(initial) {
  let value = initial >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeLookupPath(path) {
  if (!path) return '/';
  if (path.charCodeAt(0) === 47) return path;
  return `/${path}`;
}

function buildWeightedRoutes(definitions) {
  const entries = [];
  let totalWeight = 0;
  for (const route of definitions) {
    if (!route || typeof route.generateUrl !== 'function') continue;
    const weight = Number(route.count) > 0 ? Number(route.count) : 1;
    totalWeight += weight;
    entries.push({
      path: route.path,
      generateUrl: route.generateUrl,
      cumulative: totalWeight,
    });
  }
  return { entries, totalWeight };
}

function pickWeightedRoute(weighted, rng) {
  const roll = rng() * weighted.totalWeight;
  for (const route of weighted.entries) {
    if (roll < route.cumulative) return route;
  }
  return weighted.entries[weighted.entries.length - 1];
}

function buildLookups(definitions, rng, count) {
  const weighted = buildWeightedRoutes(definitions);
  const lookups = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const route = pickWeightedRoute(weighted, rng);
    lookups[i] = ['GET', normalizeLookupPath(route.generateUrl(rng))];
  }
  return lookups;
}

const router = createRouter();
for (const route of routes) {
  router.on('GET', route.path, () => {});
}

const seed = Number(process.env.PROFILE_SEED ?? Date.now());
const lookupsPerIteration = Number(process.env.PROFILE_LOOKUPS ?? 128);
const lookups = buildLookups(routes, createRng(seed ^ 0x9e3779b9), lookupsPerIteration);
const iterations = Number(process.env.PROFILE_ITERS ?? 200000);

for (let i = 0; i < iterations; i += 1) {
  for (let j = 0; j < lookups.length; j += 1) {
    const entry = lookups[j];
    router.find(entry[0], entry[1]);
  }
}
