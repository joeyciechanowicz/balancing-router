import { bench, measure, run } from "mitata";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { routes, precomputedUrls } from "./routes.mjs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const asyncMode = args.has("--async");
const timeIndex = process.argv.indexOf("--time");
const timeArg = timeIndex !== -1 ? Number(process.argv[timeIndex + 1]) : null;
const benchTime = Number.isFinite(timeArg) && timeArg > 0 ? timeArg : 1000;
const onlyIndex = process.argv.indexOf("--only");
const onlyName = onlyIndex !== -1 ? process.argv[onlyIndex + 1] : null;
const seedIndex = process.argv.indexOf("--seed");
const seedArg = seedIndex !== -1 ? Number(process.argv[seedIndex + 1]) : null;
const seed =
  Number.isFinite(seedArg) && seedArg !== null ? seedArg : Date.now();
const routerPathIndex = process.argv.indexOf("--router");
const routerPath =
  routerPathIndex !== -1 ? process.argv[routerPathIndex + 1] : null;

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

function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function loadRouter() {
  if (routerPath) {
    const routerRequire = createRequire(resolve(routerPath));
    return routerRequire(routerPath);
  }
  return require(resolve(root, "dist", "index.js"));
}

const { createRouter, createAutomatonRouter } = loadRouter();
function logBuildError(name, error) {
  const message = error && error.stack ? error.stack : String(error);
  console.error(`[bench] ${name} setup failed:\n${message}`);
}
const requestCache = new Map();
function getRequest(method, path) {
  const key = `${method} ${path}`;
  let request = requestCache.get(key);
  if (!request) {
    request = new Request(`http://localhost${path}`, { method });
    requestCache.set(key, request);
  }
  return request;
}

const METHOD = "GET";

function normalizeLookupPath(path) {
  if (!path) return "/";
  if (path.charCodeAt(0) === 47) return path;
  return `/${path}`;
}

const routeDefinitions = routes;

const defaultHandler = () => {};
const routeFixtures = routeDefinitions.map((route) => [
  METHOD,
  route.path,
  defaultHandler,
]);
function toFrameworkSafePath(path) {
  return path.replace(/:([A-Za-z0-9_]+)\([^)]*\)/g, ":$1");
}
const frameworkPatternSet = new Set();
for (const route of routeDefinitions) {
  for (const concretePath of route.concretePaths) {
    frameworkPatternSet.add(toFrameworkSafePath(concretePath));
  }
}
const frameworkRouteFixtures = [...frameworkPatternSet].map((path) => [
  METHOD,
  path,
  defaultHandler,
]);

function createRouteMatcher(concretePatterns) {
  const router = createRouter();
  for (const pattern of concretePatterns) {
    router.on(METHOD, pattern, defaultHandler);
  }
  return (path) => router.find(METHOD, path) !== null;
}

function validateRouteDefinitions(definitions) {
  const lowRng = () => 0.01;
  const highRng = () => 0.99;
  for (const route of definitions) {
    if (!Number.isInteger(route.count) || route.count < 0) {
      throw new Error(
        `[bench] Invalid count for route ${String(route.path)}: ${route.count}`,
      );
    }
    const matcher = createRouteMatcher(route.concretePaths);
    const variants = new Set();
    const rngs = [lowRng, highRng, createRng(seed ^ 0x17f12f3a)];
    for (const rng of rngs) {
      for (let i = 0; i < 32; i += 1) {
        const raw = route.generateUrl(rng);
        const normalized = normalizeLookupPath(raw);
        if (!matcher(normalized)) {
          throw new Error(
            `[bench] Generator produced non-matching URL for route ${String(route.path)}: ${raw}`,
          );
        }
        variants.add(raw);
      }
    }
    if (variants.size < 2) {
      throw new Error(
        `[bench] Route ${String(route.path)} must generate at least 2 variants`,
      );
    }
  }
}

function buildRequestCorpus(definitions, rng) {
  let total = 0;
  for (const route of definitions) total += route.count;
  const paths = new Array(total);
  const interned = new Map();
  let index = 0;
  for (const route of definitions) {
    for (let i = 0; i < route.count; i += 1) {
      const normalized = normalizeLookupPath(route.generateUrl(rng));
      const stable = interned.get(normalized);
      if (stable !== undefined) {
        paths[index] = stable;
      } else {
        interned.set(normalized, normalized);
        paths[index] = normalized;
      }
      index += 1;
    }
  }
  shuffle(paths, rng);
  return paths;
}

function createCorpusLookup(paths) {
  let index = 0;
  const size = paths.length;
  return () => {
    const path = paths[index];
    index += 1;
    if (index === size) index = 0;
    return [METHOD, path];
  };
}

validateRouteDefinitions(routeDefinitions);
const fullRequestCorpus = precomputedUrls
  ? precomputedUrls.map((path) => normalizeLookupPath(path))
  : buildRequestCorpus(routeDefinitions, createRng(seed ^ 0x0fedcba1));

function buildBalancingRouter() {
  const router = createRouter();
  for (const [method, path, handler] of routeFixtures) {
    router.on(method, path, handler);
  }
  return {
    lookup: (method, path) => {
      return router.find(method, path);
    },
    warmup: () => router.rebalance(),
  };
}

function buildBalancingRouterV2() {
  if (typeof createAutomatonRouter !== "function") return null;
  const router = createAutomatonRouter();
  for (const [method, path, handler] of routeFixtures) {
    router.on(method, path, handler);
  }
  return {
    lookup: (method, path) => {
      return router.find(method, path);
    },
  };
}

function buildFindMyWay() {
  try {
    const findMyWay = require("find-my-way");
    const router = findMyWay();
    for (const [method, path, handler] of routeFixtures) {
      router.on(method, path, handler);
    }
    return { lookup: (method, path) => router.find(method, path) };
  } catch (error) {
    logBuildError("find-my-way", error);
    return null;
  }
}

function buildTrouter() {
  try {
    const { Trouter } = require("trouter");
    const router = new Trouter();
    for (const [method, path, handler] of routeFixtures) {
      router.add(method, path, handler);
    }
    return { lookup: (method, path) => router.find(method, path) };
  } catch (error) {
    logBuildError("trouter", error);
    return null;
  }
}

function buildRadix3() {
  try {
    const { createRouter: createRadixRouter } = require("radix3");
    const router = createRadixRouter();
    const stores = new Map();
    for (const [method, path, handler] of routeFixtures) {
      let store = stores.get(path);
      if (!store) {
        store = Object.create(null);
        router.insert(path, store);
        stores.set(path, store);
      }
      store[method] = handler;
    }
    return {
      lookup: (method, path) => {
        const match = router.lookup(path);
        if (!match) return null;
        return match[method] ?? match["*"] ?? null;
      },
    };
  } catch (error) {
    logBuildError("radix3", error);
    return null;
  }
}

function buildMedleyRouter() {
  try {
    const Router = require("@medley/router");
    const router = new Router();
    for (const [method, path, handler] of routeFixtures) {
      const store = router.register(path);
      store[method] = handler;
    }
    return {
      lookup: (method, path) => {
        const match = router.find(path);
        if (!match) return null;
        return match.store[method] ?? match.store["*"] ?? null;
      },
    };
  } catch (error) {
    logBuildError("@medley/router", error);
    return null;
  }
}

function buildIttyRouter() {
  try {
    const { IttyRouter } = require("itty-router");
    const router = IttyRouter();
    for (const [method, path, handler] of routeFixtures) {
      const register = router[method.toLowerCase()] ?? router.all;
      register.call(router, path, handler);
    }
    return {
      lookup: async (method, path, request) => {
        return router.fetch(request ?? getRequest(method, path));
      },
      async: true,
      framework: true,
    };
  } catch (error) {
    logBuildError("itty-router", error);
    return null;
  }
}

async function buildFastify() {
  try {
    const fastifyFactory = require("fastify");
    const fastify = fastifyFactory({ logger: false });
    for (const [method, path] of routeFixtures) {
      fastify.route({
        method,
        url: path,
        handler: () => "",
      });
    }
    await fastify.ready();
    return {
      lookup: (method, path) => fastify.inject({ method, url: path }),
      async: true,
      framework: true,
    };
  } catch (error) {
    logBuildError("fastify", error);
    return null;
  }
}

function buildHono() {
  try {
    const { Hono } = require("hono");
    const app = new Hono();
    for (const [method, path] of frameworkRouteFixtures) {
      app.on(method, path, () => new Response(null));
    }
    return {
      lookup: (method, path, request) =>
        app.request(request ?? path, request ? undefined : { method }),
      async: true,
      framework: true,
    };
  } catch (error) {
    logBuildError("hono", error);
    return null;
  }
}

function buildH3() {
  try {
    const {
      createApp,
      createRouter,
      eventHandler,
      toWebHandler,
    } = require("h3");
    const app = createApp();
    const router = createRouter();
    for (const [method, path] of routeFixtures) {
      router[method.toLowerCase()](
        path,
        eventHandler(() => ""),
      );
    }
    app.use(router);
    const handler = toWebHandler(app);
    return {
      lookup: (method, path, request) => {
        return handler(request ?? getRequest(method, path));
      },
      async: true,
      framework: true,
    };
  } catch (error) {
    logBuildError("h3", error);
    return null;
  }
}

function createMockReqRes(method, path) {
  const { IncomingMessage, ServerResponse } = require("node:http");
  const { PassThrough } = require("node:stream");
  const socket = new PassThrough();
  socket.destroyed = false;
  socket.setTimeout = () => {};
  socket.destroy = () => {};
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = path;
  const res = new ServerResponse(req);
  res.assignSocket(socket);
  return { req, res };
}

function toPathToRegexpPattern(path) {
  if (path.includes(":")) {
    return path.replace(/:([A-Za-z0-9_]+)\*/g, "*$1");
  }
  return path;
}

function toRegexparamPattern(path) {
  return path.replace(/:([A-Za-z0-9_]+)\*/g, "*");
}

function buildKoaRouter() {
  try {
    const Koa = require("koa");
    const Router = require("@koa/router");
    const app = new Koa();
    const router = new Router();
    for (const [method, path] of frameworkRouteFixtures) {
      const koaPath = toPathToRegexpPattern(path);
      router[method.toLowerCase()](koaPath, (ctx) => {
        ctx.status = 200;
        ctx.body = "";
      });
    }
    app.use(router.routes());
    const handler = app.callback();
    return {
      lookup: async (method, path) => {
        const { req, res } = createMockReqRes(method, path);
        return handler(req, res);
      },
      async: true,
      framework: true,
    };
  } catch (error) {
    logBuildError("@koa/router", error);
    return null;
  }
}

function buildTinyHttp() {
  try {
    const { App } = require("@tinyhttp/app");
    const app = new App();
    for (const [method, path] of routeFixtures) {
      const tinyPath = toRegexparamPattern(path);
      app[method.toLowerCase()](tinyPath, (_req, res) => {
        res.status(200).end("");
      });
    }
    return {
      lookup: async (method, path) => {
        const { req, res } = createMockReqRes(method, path);
        return app.handler(req, res);
      },
      async: true,
      framework: true,
    };
  } catch (error) {
    logBuildError("@tinyhttp/app", error);
    return null;
  }
}

function calculateRme(samples) {
  if (!samples || samples.length < 2) return 0;
  const n = samples.length;
  const mean = samples.reduce((sum, value) => sum + value, 0) / n;
  if (mean === 0) return 0;
  const variance =
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance) / Math.sqrt(n);
  const margin = 1.96 * standardError;
  return (margin / mean) * 100;
}

async function runBenchmarks() {
  const warmupRounds = 50000;
  const results = [];

  const routerBuilders = [
    ["balancing-router", () => buildBalancingRouter()],
    ["balancing-router-v2", () => buildBalancingRouterV2()],
    ["find-my-way", () => buildFindMyWay()],
    ["trouter", () => buildTrouter()],
    ["radix3", () => buildRadix3()],
    ["@medley/router", () => buildMedleyRouter()],
    ["itty-router", () => (asyncMode ? buildIttyRouter() : null)],
    ["fastify", () => (asyncMode ? buildFastify() : null)],
    ["hono", () => (asyncMode ? buildHono() : null)],
    ["h3", () => (asyncMode ? buildH3() : null)],
    ["@koa/router", () => (asyncMode ? buildKoaRouter() : null)],
    ["@tinyhttp/app", () => (asyncMode ? buildTinyHttp() : null)],
  ];

  const routers = [];
  for (const [name, build] of routerBuilders) {
    if (onlyName && name !== onlyName) continue;
    let entry = null;
    try {
      entry = await build();
    } catch (error) {
      logBuildError(name, error);
      continue;
    }
    if (!entry) continue;
    routers.push([name, entry]);
  }

  if (!jsonOutput) {
    for (const [name, routerEntry] of routers) {
      const { lookup, warmup, framework } = routerEntry;
      const nextLookup = createCorpusLookup(fullRequestCorpus);
      const benchLookup = asyncMode
        ? async () => {
            const [method, path] = nextLookup();
            if (framework) {
              await lookup(method, path, getRequest(method, path));
              return;
            }
            await lookup(method, path);
          }
        : () => {
          const [method, path] = nextLookup();
          lookup(method, path);
          };
      for (let i = 0; i < warmupRounds; i += 1) {
        if (asyncMode) {
          await benchLookup();
        } else {
          benchLookup();
        }
      }
      if (warmup) warmup();
      bench(name, async function* () {
        yield benchLookup;
      });
    }
    await run({ format: "mitata" });
    return null;
  }

  for (const [name, routerEntry] of routers) {
    const { lookup, warmup, framework } = routerEntry;
    const nextLookup = createCorpusLookup(fullRequestCorpus);
    const benchLookup = asyncMode
      ? async () => {
          const [method, path] = nextLookup();
          if (framework) {
            await lookup(method, path, getRequest(method, path));
            return;
          }
          await lookup(method, path);
        }
      : () => {
          const [method, path] = nextLookup();
          lookup(method, path);
        };
    for (let i = 0; i < warmupRounds; i += 1) {
      if (asyncMode) {
        await benchLookup();
      } else {
        benchLookup();
      }
    }
    if (warmup) warmup();
    const stats = await measure(
      async function* () {
        yield benchLookup;
      },
      { min_cpu_time: benchTime * 1e6 },
    );

    const hz = stats.avg > 0 ? 1e9 / stats.avg : 0;
    const samples = stats.samples ?? [];
    results.push({
      name,
      hz,
      samples: samples.length,
      rme: calculateRme(samples),
    });
  }

  return results.sort((a, b) => a.hz - b.hz);
}

const results = await runBenchmarks();
if (jsonOutput) {
  console.log(JSON.stringify({ results, seed }, null, 2));
} else if (results) {
  for (const result of results) {
    console.log(
      `${result.name}: ${Math.round(result.hz).toLocaleString()} ops/sec (samples: ${result.samples}, rme: ${result.rme.toFixed(2)}%)`,
    );
  }
}
