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
const routerPathIndex = process.argv.indexOf("--router");
const routerPath =
  routerPathIndex !== -1 ? process.argv[routerPathIndex + 1] : null;

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

const lookups = [];
const userIds = ["1", "42", "123", "999", "1001"];
const productIds = ["10", "200", "1234", "7777", "9090"];
const orderIds = ["500", "600", "700", "800"];
const itemIds = ["1", "2", "3"];
const slugs = ["hello-world", "node-routing", "perf-tips"];
const months = ["01", "02", "12"];

lookups.push(["GET", "/users"]);
for (const id of userIds) {
  lookups.push(["GET", `/users/${id}`]);
  lookups.push(["GET", `/users/${id}/settings`]);
  lookups.push(["GET", `/api/v1/users/${id}`]);
  lookups.push(["GET", `/api/v2/users/${id}/settings`]);
  lookups.push(["PATCH", `/users/${id}`]);
  lookups.push(["DELETE", `/users/${id}`]);
}
lookups.push(["GET", "/assets/css/app.css"]);
lookups.push(["GET", "/assets/js/app.js"]);
lookups.push(["GET", "/assets/img/logo.png"]);
lookups.push(["GET", "/health"]);
lookups.push(["GET", "/search/node"]);
lookups.push(["GET", "/search/router"]);
lookups.push(["POST", "/users"]);
lookups.push(["POST", "/orders"]);

lookups.push(["GET", "/products"]);
for (const id of productIds) {
  lookups.push(["GET", `/products/${id}`]);
  lookups.push(["GET", `/products/${id}/reviews`]);
  lookups.push(["PUT", `/products/${id}`]);
}

for (const id of orderIds) {
  lookups.push(["GET", `/orders/${id}`]);
  lookups.push(["DELETE", `/orders/${id}`]);
  for (const itemId of itemIds) {
    lookups.push(["GET", `/orders/${id}/items/${itemId}`]);
  }
}

for (const categoryId of ["books", "tech", "home"]) {
  lookups.push(["GET", `/categories/${categoryId}/products`]);
}

for (const year of ["2023", "2024"]) {
  for (const month of months) {
    for (const slug of slugs) {
      lookups.push(["GET", `/blog/${year}/${month}/${slug}`]);
    }
  }
}

function buildBalancingRouter() {
  const router = createRouter();
  for (const [method, path, handler] of routeFixtures) {
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
    for (const [method, path, handler] of routeFixtures) {
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
    for (const [method, path, handler] of routeFixtures) {
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

  const routers = [
    ["balancing-router", buildBalancingRouter()],
    ["find-my-way", buildFindMyWay()],
    ["trouter", buildTrouter()],
  ].filter((entry) => entry[1]);

  for (const [name, routerEntry] of routers) {
    const { lookup, warmup } = routerEntry;
    for (let i = 0; i < warmupRounds; i += 1) {
      for (const [method, path] of lookups) {
        lookup(method, path);
      }
    }
    if (warmup) warmup();
    bench.add(name, () => {
      for (const [method, path] of lookups) {
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
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const result of results) {
    console.log(
      `${result.name}: ${Math.round(result.hz).toLocaleString()} ops/sec (samples: ${result.samples}, rme: ${result.rme.toFixed(2)}%)`,
    );
  }
}
