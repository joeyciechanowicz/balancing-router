import { bench, measure, run } from "mitata";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

function pick(array, rng) {
  return array[Math.floor(rng() * array.length)];
}

function loadRouter() {
  if (routerPath) {
    const routerRequire = createRequire(resolve(routerPath));
    return routerRequire(routerPath);
  }
  return require(resolve(root, "dist", "index.js"));
}

const { createRouter } = loadRouter();
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

const userIds = ["1", "42", "123", "999", "1001"];
const productIds = ["10", "200", "1234", "7777", "9090"];
const orderIds = ["500", "600", "700", "800"];
const itemIds = ["1", "2", "3"];
const slugs = ["hello-world", "node-routing", "perf-tips"];
const months = ["01", "02", "12"];
const categories = ["books", "tech", "home"];
const years = ["2023", "2024"];
const assetFiles = ["css/app.css", "js/app.js", "img/logo.png"];
const searchTerms = ["node", "router", "http", "perf"];
const apiVersions = ["1", "2", "10", "42"];
const reportIds = ["1", "7", "42", "900"];
const urlArgs = ["alpha", "bravo", "charlie"];

const routeDefinitions = [
  { method: "GET", pattern: "/users", weight: 15, makePath: () => "/users" },
  {
    method: "GET",
    pattern: "/users/:id",
    weight: 10,
    makePath: (rng) => `/users/${pick(userIds, rng)}`,
  },
  {
    method: "GET",
    pattern: "/users/:id/settings",
    weight: 5,
    makePath: (rng) => `/users/${pick(userIds, rng)}/settings`,
  },
  {
    method: "GET",
    pattern: "/some/url/:arg",
    weight: 3,
    makePath: (rng) => `/some/url/${pick(urlArgs, rng)}`,
  },
  {
    method: "GET",
    pattern: /^\/some\/url-[a-z]+$/,
    weight: 2,
    makePath: (rng) => `/some/url-${pick(urlArgs, rng)}`,
  },
  {
    method: "GET",
    pattern: "/reports/:id",
    weight: 2,
    makePath: (rng) => `/reports/${pick(reportIds, rng)}`,
  },
  {
    method: "GET",
    pattern: /^\/reports-\d+$/,
    weight: 2,
    makePath: (rng) => `/reports-${pick(reportIds, rng)}`,
  },
  {
    method: "GET",
    pattern: /^\/products-\d+$/,
    weight: 2,
    makePath: (rng) => `/products-${pick(productIds, rng)}`,
  },
  {
    method: "GET",
    pattern: /^\/api\/v\d+\/health$/,
    weight: 2,
    makePath: (rng) => `/api/v${pick(apiVersions, rng)}/health`,
  },
  {
    method: "GET",
    pattern: "/api/v1/users/:id",
    weight: 5,
    makePath: (rng) => `/api/v1/users/${pick(userIds, rng)}`,
  },
  {
    method: "GET",
    pattern: "/api/v2/users/:id/settings",
    weight: 2,
    makePath: (rng) => `/api/v2/users/${pick(userIds, rng)}/settings`,
  },
  {
    method: "PATCH",
    pattern: "/users/:id",
    weight: 5,
    makePath: (rng) => `/users/${pick(userIds, rng)}`,
  },
  {
    method: "DELETE",
    pattern: "/users/:id",
    weight: 5,
    makePath: (rng) => `/users/${pick(userIds, rng)}`,
  },
  {
    method: "GET",
    pattern: "/assets/:path*",
    weight: 5,
    makePath: (rng) => `/assets/${pick(assetFiles, rng)}`,
  },
  { method: "GET", pattern: "/health", weight: 5, makePath: () => "/health" },
  {
    method: "GET",
    pattern: "/search/:query",
    weight: 5,
    makePath: (rng) => `/search/${pick(searchTerms, rng)}`,
  },
  { method: "POST", pattern: "/users", weight: 5, makePath: () => "/users" },
  {
    method: "POST",
    pattern: "/orders",
    weight: 3,
    makePath: () => "/orders",
  },
  {
    method: "GET",
    pattern: "/products",
    weight: 3,
    makePath: () => "/products",
  },
  {
    method: "GET",
    pattern: "/products/:productId",
    weight: 4,
    makePath: (rng) => `/products/${pick(productIds, rng)}`,
  },
  {
    method: "GET",
    pattern: "/products/:productId/reviews",
    weight: 3,
    makePath: (rng) => `/products/${pick(productIds, rng)}/reviews`,
  },
  {
    method: "PUT",
    pattern: "/products/:productId",
    weight: 2,
    makePath: (rng) => `/products/${pick(productIds, rng)}`,
  },
  {
    method: "GET",
    pattern: "/orders/:orderId",
    weight: 2,
    makePath: (rng) => `/orders/${pick(orderIds, rng)}`,
  },
  {
    method: "DELETE",
    pattern: "/orders/:orderId",
    weight: 1,
    makePath: (rng) => `/orders/${pick(orderIds, rng)}`,
  },
  {
    method: "GET",
    pattern: "/orders/:orderId/items/:itemId",
    weight: 1,
    makePath: (rng) =>
      `/orders/${pick(orderIds, rng)}/items/${pick(itemIds, rng)}`,
  },
  {
    method: "GET",
    pattern: "/blog/:year/:month/:slug",
    weight: 1,
    makePath: (rng) =>
      `/blog/${pick(years, rng)}/${pick(months, rng)}/${pick(slugs, rng)}`,
  },
];

const defaultHandler = () => {};
const stringRouteFixtures = routeDefinitions
  .filter((route) => typeof route.pattern === "string")
  .map((route) => [route.method, route.pattern, defaultHandler]);
const regexRouteFixtures = routeDefinitions
  .filter((route) => route.pattern instanceof RegExp)
  .map((route) => [route.method, route.pattern, defaultHandler]);
const shuffledStringFixtures = shuffle(
  [...stringRouteFixtures],
  createRng(seed ^ 0x6b43a9d6),
);

function buildWeightedRoutes(definitions) {
  let totalWeight = 0;
  const entries = definitions.map((route) => {
    totalWeight += route.weight;
    return { ...route, cumulative: totalWeight };
  });
  return { entries, totalWeight };
}

const weightedRoutes = {
  all: buildWeightedRoutes(routeDefinitions),
  stringOnly: buildWeightedRoutes(
    routeDefinitions.filter((route) => typeof route.pattern === "string"),
  ),
};

function tryRegisterRegexRoutes(register) {
  try {
    for (const [method, path, handler] of regexRouteFixtures) {
      register(method, path, handler);
    }
    return true;
  } catch {
    return false;
  }
}

function pickWeightedRoute(table, rng) {
  const roll = rng() * table.totalWeight;
  for (const entry of table.entries) {
    if (roll < entry.cumulative) return entry;
  }
  return table.entries[table.entries.length - 1];
}

function createLookup(rng, includeRegex) {
  const table = includeRegex ? weightedRoutes.all : weightedRoutes.stringOnly;
  return () => {
    const route = pickWeightedRoute(table, rng);
    return [route.method, route.makePath(rng)];
  };
}

function buildBalancingRouter() {
  const router = createRouter();
  for (const [method, path, handler] of shuffledStringFixtures) {
    router.on(method, path, handler);
  }
  const supportsRegex = tryRegisterRegexRoutes((method, path, handler) =>
    router.on(method, path, handler),
  );
  return {
    lookup: (method, path) => {
      return router.find(method, path);
    },
    warmup: () => router.rebalance(),
    supportsRegex,
  };
}

function buildFindMyWay() {
  try {
    const findMyWay = require("find-my-way");
    const router = findMyWay();
    for (const [method, path, handler] of shuffledStringFixtures) {
      router.on(method, path, handler);
    }
    const supportsRegex = tryRegisterRegexRoutes((method, path, handler) =>
      router.on(method, path, handler),
    );
    return { lookup: (method, path) => router.find(method, path), supportsRegex };
  } catch (error) {
    logBuildError("find-my-way", error);
    return null;
  }
}

function buildTrouter() {
  try {
    const { Trouter } = require("trouter");
    const router = new Trouter();
    for (const [method, path, handler] of shuffledStringFixtures) {
      router.add(method, path, handler);
    }
    const supportsRegex = tryRegisterRegexRoutes((method, path, handler) =>
      router.add(method, path, handler),
    );
    return { lookup: (method, path) => router.find(method, path), supportsRegex };
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
    for (const [method, path, handler] of shuffledStringFixtures) {
      let store = stores.get(path);
      if (!store) {
        store = Object.create(null);
        router.insert(path, store);
        stores.set(path, store);
      }
      store[method] = handler;
    }
    const supportsRegex = tryRegisterRegexRoutes((method, path, handler) => {
      let store = stores.get(path);
      if (!store) {
        store = Object.create(null);
        router.insert(path, store);
        stores.set(path, store);
      }
      store[method] = handler;
    });
    return {
      lookup: (method, path) => {
        const match = router.lookup(path);
        if (!match) return null;
        return match[method] ?? match["*"] ?? null;
      },
      supportsRegex,
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
    for (const [method, path, handler] of shuffledStringFixtures) {
      const store = router.register(path);
      store[method] = handler;
    }
    const supportsRegex = tryRegisterRegexRoutes((method, path, handler) => {
      const store = router.register(path);
      store[method] = handler;
    });
    return {
      lookup: (method, path) => {
        const match = router.find(path);
        if (!match) return null;
        return match.store[method] ?? match.store["*"] ?? null;
      },
      supportsRegex,
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
    for (const [method, path, handler] of shuffledStringFixtures) {
      const register = router[method.toLowerCase()] ?? router.all;
      register.call(router, path, handler);
    }
    const supportsRegex = tryRegisterRegexRoutes((method, path, handler) => {
      const register = router[method.toLowerCase()] ?? router.all;
      register.call(router, path, handler);
    });
    return {
      lookup: async (method, path, request) => {
        return router.fetch(request ?? getRequest(method, path));
      },
      async: true,
      framework: true,
      supportsRegex,
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
    for (const [method, path] of shuffledStringFixtures) {
      fastify.route({
        method,
        url: path,
        handler: () => "",
      });
    }
    await fastify.ready();
    const supportsRegex = tryRegisterRegexRoutes((method, path) => {
      fastify.route({
        method,
        url: path,
        handler: () => "",
      });
    });
    return {
      lookup: (method, path) => fastify.inject({ method, url: path }),
      async: true,
      framework: true,
      supportsRegex,
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
    for (const [method, path] of shuffledStringFixtures) {
      app.on(method, path, () => new Response(null));
    }
    const supportsRegex = tryRegisterRegexRoutes((method, path) => {
      app.on(method, path, () => new Response(null));
    });
    return {
      lookup: (method, path, request) =>
        app.request(request ?? path, request ? undefined : { method }),
      async: true,
      framework: true,
      supportsRegex,
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
    for (const [method, path] of shuffledStringFixtures) {
      router[method.toLowerCase()](
        path,
        eventHandler(() => ""),
      );
    }
    app.use(router);
    const handler = toWebHandler(app);
    const supportsRegex = tryRegisterRegexRoutes((method, path) => {
      router[method.toLowerCase()](
        path,
        eventHandler(() => ""),
      );
    });
    return {
      lookup: (method, path, request) => {
        return handler(request ?? getRequest(method, path));
      },
      async: true,
      framework: true,
      supportsRegex,
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
    for (const [method, path] of shuffledStringFixtures) {
      const koaPath = toPathToRegexpPattern(path);
      router[method.toLowerCase()](koaPath, (ctx) => {
        ctx.status = 200;
        ctx.body = "";
      });
    }
    app.use(router.routes());
    const handler = app.callback();
    const supportsRegex = tryRegisterRegexRoutes((method, path) => {
      router[method.toLowerCase()](path, (ctx) => {
        ctx.status = 200;
        ctx.body = "";
      });
    });
    return {
      lookup: async (method, path) => {
        const { req, res } = createMockReqRes(method, path);
        return handler(req, res);
      },
      async: true,
      framework: true,
      supportsRegex,
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
    for (const [method, path] of shuffledStringFixtures) {
      const tinyPath = toRegexparamPattern(path);
      app[method.toLowerCase()](tinyPath, (_req, res) => {
        res.status(200).end("");
      });
    }
    const supportsRegex = tryRegisterRegexRoutes((method, path) => {
      app[method.toLowerCase()](path, (_req, res) => {
        res.status(200).end("");
      });
    });
    return {
      lookup: async (method, path) => {
        const { req, res } = createMockReqRes(method, path);
        return app.handler(req, res);
      },
      async: true,
      framework: true,
      supportsRegex,
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
  const lookupRng = createRng(seed ^ 0x9e3779b9);
  const results = [];

  const routerBuilders = [
    ["balancing-router", () => buildBalancingRouter()],
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
    const entry = await build();
    if (!entry) continue;
    routers.push([name, entry]);
  }

  if (!jsonOutput) {
    for (const [name, routerEntry] of routers) {
      const { lookup, warmup } = routerEntry;
      const includeRegex = routerEntry.supportsRegex === true;
      const nextLookup = createLookup(lookupRng, includeRegex);
      const benchLookup = asyncMode
        ? async () => {
            const [method, path] = nextLookup();
            await lookup(method, path, getRequest(method, path));
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
      bench(
        name,
        async function* () {
          yield benchLookup;
        },
      );
    }
    await run({ format: "mitata" });
    return null;
  }

  for (const [name, routerEntry] of routers) {
    const { lookup, warmup } = routerEntry;
    const includeRegex = routerEntry.supportsRegex === true;
    const nextLookup = createLookup(lookupRng, includeRegex);
    const benchLookup = asyncMode
      ? async () => {
          const [method, path] = nextLookup();
          await lookup(method, path, getRequest(method, path));
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
