import { Bench } from "tinybench";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
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
  ["POST", "/users", () => {}],
  ["DELETE", "/users/:id", () => {}],
];

const lookups = [
  ["GET", "/users"],
  ["GET", "/users/123"],
  ["GET", "/users/123/settings"],
  ["GET", "/assets/css/app.css"],
  ["GET", "/health"],
  ["GET", "/search/node"],
  ["POST", "/users"],
  ["DELETE", "/users/999"],
];

function buildBalancingRouter() {
  const router = createRouter();
  for (const [method, path, handler] of routeFixtures) {
    router.on(method, path, handler);
  }
  router.on("GET", /^\/api\/v\d+\/health$/, () => {});
  let counter = 0;
  return (method, path) => {
    const result = router.find(method, path);
    counter += 1;
    if (counter % 50000 === 0) {
      router.rebalance();
    }
    return result;
  };
}

function buildFindMyWay() {
  try {
    const findMyWay = require("find-my-way");
    const router = findMyWay();
    for (const [method, path, handler] of routeFixtures) {
      router.on(method, path, handler);
    }
    return (method, path) => router.find(method, path);
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
    return (method, path) => router.find(method, path);
  } catch (error) {
    console.error("trouter", error);
    return null;
  }
}

async function runBenchmarks() {
  const bench = new Bench({ time: 200 });

  const routers = [
    ["balancing-router", buildBalancingRouter()],
    ["find-my-way", buildFindMyWay()],
    ["trouter", buildTrouter()],
  ].filter((entry) => entry[1]);

  for (const [name, lookup] of routers) {
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
  }));
}

const results = await runBenchmarks();
if (jsonOutput) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const result of results) {
    console.log(
      `${result.name}: ${Math.round(result.hz).toLocaleString()} ops/sec (samples: ${result.samples})`,
    );
  }
}
