import { Bench } from "tinybench";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
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
  if (roll < 0.4) return ["GET", `/api/v2/users/${pick(userIds, rng)}/settings`];
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
  router.on("GET", /^\/api\/v\d+\/health$/, () => {});
  return {
    lookup: (method, path) => router.find(method, path),
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

async function runBenchmarks() {
  const bench = new Bench({ time: benchTime });
  const warmupRounds = 50000;
  const lookupRng = createRng(seed ^ 0x9e3779b9);

  const routers = [
    ["balancing-router", buildBalancingRouter()],
    ["find-my-way", buildFindMyWay()],
    ["trouter", buildTrouter()],
  ]
    .filter((entry) => entry[1])
    .filter((entry) => (onlyName ? entry[0] === onlyName : true));

  for (const [name, routerEntry] of routers) {
    const { lookup, warmup } = routerEntry;
    for (let i = 0; i < warmupRounds; i += 1) {
      const [method, path] = makeLookup(lookupRng);
      lookup(method, path);
    }
    if (warmup) warmup();
    bench.add(name, () => {
      for (let i = 0; i < lookupsPerIteration; i += 1) {
        const [method, path] = makeLookup(lookupRng);
        lookup(method, path);
      }
    });
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
