import { Bench } from "tinybench";
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
const lookupsPerIteration = 64;
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

const routeFixtures = [
  ["GET", "/users", () => {}],
  ["GET", "/users/:id", () => {}],
  ["GET", "/users/:id/settings", () => {}],
  ["GET", "/assets/:path*", () => {}],
  ["GET", "/health", () => {}],
  ["GET", "/search/:query", () => {}],
  ["GET", "/products", () => {}],
  ["GET", "/products/:productId", () => {}],
  ["GET", "/products/:productId/reviews", () => {}],
  ["GET", "/categories/:categoryId/products", () => {}],
  ["GET", "/orders/:orderId", () => {}],
  ["GET", "/orders/:orderId/items/:itemId", () => {}],
  ["GET", "/blog/:year/:month/:slug", () => {}],
  ["GET", "/api/v1/users/:id", () => {}],
  ["GET", "/api/v2/users/:id/settings", () => {}],
  ["POST", "/users", () => {}],
  ["POST", "/orders", () => {}],
  ["PUT", "/products/:productId", () => {}],
  ["PATCH", "/users/:id", () => {}],
  ["DELETE", "/users/:id", () => {}],
  ["DELETE", "/orders/:orderId", () => {}],
];

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

function makeLookup(rng) {
  const roll = rng();
  if (roll < 0.15) return ["GET", "/users"];
  if (roll < 0.25) return ["GET", `/users/${pick(userIds, rng)}`];
  if (roll < 0.3) return ["GET", `/users/${pick(userIds, rng)}/settings`];
  if (roll < 0.35) return ["GET", `/api/v1/users/${pick(userIds, rng)}`];
  if (roll < 0.4)
    return ["GET", `/api/v2/users/${pick(userIds, rng)}/settings`];
  if (roll < 0.45) return ["PATCH", `/users/${pick(userIds, rng)}`];
  if (roll < 0.5) return ["DELETE", `/users/${pick(userIds, rng)}`];
  if (roll < 0.55) return ["GET", `/assets/${pick(assetFiles, rng)}`];
  if (roll < 0.6) return ["GET", "/health"];
  if (roll < 0.65) return ["GET", `/search/${pick(searchTerms, rng)}`];
  if (roll < 0.7) return ["POST", "/users"];
  if (roll < 0.75) return ["POST", "/orders"];
  if (roll < 0.8) return ["GET", "/products"];
  if (roll < 0.85) return ["GET", `/products/${pick(productIds, rng)}`];
  if (roll < 0.88) return ["GET", `/products/${pick(productIds, rng)}/reviews`];
  if (roll < 0.91) return ["PUT", `/products/${pick(productIds, rng)}`];
  if (roll < 0.94) return ["GET", `/orders/${pick(orderIds, rng)}`];
  if (roll < 0.96) return ["DELETE", `/orders/${pick(orderIds, rng)}`];
  if (roll < 0.98) {
    return [
      "GET",
      `/orders/${pick(orderIds, rng)}/items/${pick(itemIds, rng)}`,
    ];
  }
  if (roll < 0.99) {
    return ["GET", `/categories/${pick(categories, rng)}/products`];
  }
  return [
    "GET",
    `/blog/${pick(years, rng)}/${pick(months, rng)}/${pick(slugs, rng)}`,
  ];
}

function buildBalancingRouter() {
  const rng = createRng(seed);
  const fixtures = shuffle([...routeFixtures], rng);
  const router = createRouter();
  for (const [method, path, handler] of fixtures) {
    router.on(method, path, handler);
  }
  let count = 0;
  return {
    lookup: (method, path) => {
      return router.find(method, path);
    },
    warmup: () => router.rebalance(),
  };
}

function buildFindMyWay() {
  try {
    const findMyWay = require("find-my-way");
    const router = findMyWay();
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    for (const [method, path, handler] of fixtures) {
      router.on(method, path, handler);
    }
    return { lookup: (method, path) => router.find(method, path) };
  } catch (error) {
    return null;
  }
}

function buildTrouter() {
  try {
    const { Trouter } = require("trouter");
    const router = new Trouter();
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    for (const [method, path, handler] of fixtures) {
      router.add(method, path, handler);
    }
    return { lookup: (method, path) => router.find(method, path) };
  } catch (error) {
    console.error("trouter", error);
    return null;
  }
}

function buildRadix3() {
  try {
    const { createRouter: createRadixRouter } = require("radix3");
    const router = createRadixRouter();
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    const stores = new Map();
    for (const [method, path, handler] of fixtures) {
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
    return null;
  }
}

function buildMedleyRouter() {
  try {
    const Router = require("@medley/router");
    const router = new Router();
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    for (const [method, path, handler] of fixtures) {
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
    return null;
  }
}

function buildIttyRouter() {
  try {
    const { IttyRouter } = require("itty-router");
    const router = IttyRouter();
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    for (const [method, path, handler] of fixtures) {
      const register = router[method.toLowerCase()] ?? router.all;
      register.call(router, path, handler);
    }
    return {
      lookup: async (method, path) => {
        const request = new Request(`http://localhost${path}`, { method });
        return router.fetch(request);
      },
      async: true,
    };
  } catch (error) {
    return null;
  }
}

async function buildFastify() {
  try {
    const fastifyFactory = require("fastify");
    const fastify = fastifyFactory({ logger: false });
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    for (const [method, path] of fixtures) {
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
    };
  } catch (error) {
    return null;
  }
}

function buildHono() {
  try {
    const { Hono } = require("hono");
    const app = new Hono();
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    for (const [method, path] of fixtures) {
      app.on(method, path, () => new Response(null));
    }
    return {
      lookup: (method, path) => app.request(path, { method }),
      async: true,
    };
  } catch (error) {
    return null;
  }
}

function buildH3() {
  try {
    const { createApp, createRouter, eventHandler, toWebHandler } = require("h3");
    const app = createApp();
    const router = createRouter();
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    for (const [method, path] of fixtures) {
      router[method.toLowerCase()](path, eventHandler(() => ""));
    }
    app.use(router);
    const handler = toWebHandler(app);
    return {
      lookup: (method, path) => {
        const request = new Request(`http://localhost${path}`, { method });
        return handler(request);
      },
      async: true,
    };
  } catch (error) {
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

function buildKoaRouter() {
  try {
    const Koa = require("koa");
    const Router = require("@koa/router");
    const app = new Koa();
    const router = new Router();
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    for (const [method, path] of fixtures) {
      router[method.toLowerCase()](path, (ctx) => {
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
    };
  } catch (error) {
    return null;
  }
}

function buildTinyHttp() {
  try {
    const { App } = require("@tinyhttp/app");
    const app = new App();
    const rng = createRng(seed);
    const fixtures = shuffle([...routeFixtures], rng);
    for (const [method, path] of fixtures) {
      app[method.toLowerCase()](path, (_req, res) => {
        res.status(200).end("");
      });
    }
    return {
      lookup: async (method, path) => {
        const { req, res } = createMockReqRes(method, path);
        return app.handler(req, res);
      },
      async: true,
    };
  } catch (error) {
    return null;
  }
}

async function runBenchmarks() {
  const bench = new Bench({ time: benchTime });
  const warmupRounds = 50000;
  const lookupRng = createRng(seed ^ 0x9e3779b9);

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

  for (const [name, routerEntry] of routers) {
    const { lookup, warmup } = routerEntry;
    for (let i = 0; i < warmupRounds; i += 1) {
      const [method, path] = makeLookup(lookupRng);
      if (asyncMode) {
        await lookup(method, path);
      } else {
        lookup(method, path);
      }
    }
    if (warmup) warmup();
    if (asyncMode) {
      bench.add(name, async () => {
        for (let i = 0; i < lookupsPerIteration; i += 1) {
          const [method, path] = makeLookup(lookupRng);
          await lookup(method, path);
        }
      });
    } else {
      bench.add(name, () => {
        for (let i = 0; i < lookupsPerIteration; i += 1) {
          const [method, path] = makeLookup(lookupRng);
          lookup(method, path);
        }
      });
    }
  }

  await bench.run();

  return bench.tasks.map((task) => ({
    name: task.name,
    hz: task.result?.hz ?? 0,
    samples: task.result?.samples?.length ?? 0,
    rme: task.result?.rme ?? 0,
  }));
}

const results = await runBenchmarks();
if (jsonOutput) {
  console.log(JSON.stringify({ results, seed }, null, 2));
} else {
  for (const result of results) {
    console.log(
      `${result.name}: ${Math.round(result.hz).toLocaleString()} ops/sec (samples: ${result.samples}, rme: ${result.rme.toFixed(2)}%)`,
    );
  }
}
