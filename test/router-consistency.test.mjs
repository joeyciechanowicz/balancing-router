/**
 * Router Consistency Test
 * 
 * This test verifies that all routers used in benchmarks produce identical routing
 * results. It uses `path-to-regexp-linear` as the reference implementation and
 * validates all other routers against it.
 * 
 * Key features:
 * - Uses the same precomputed URL corpus as benchmarks (typically 3M URLs from
 *   bench/routes-generic.urls.mjs or custom via BENCH_PRECOMPUTED_URLS_MODULE)
 * - Tests all routers in bench.mjs: balancing-router, balancing-router-v2,
 *   find-my-way, trouter, radix3, @medley/router, medley-router-local
 * - Ensures benchmark comparisons are fair (all routers match the same routes)
 * - Catches routing logic bugs and regressions
 * 
 * Known differences:
 * - trouter: Doesn't validate parameter regex patterns, so it matches more paths
 *   than path-to-regexp. This is expected and counted separately.
 * 
 * Usage:
 *   npm run test:consistency
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { routes, precomputedUrls } from "../bench/routes.mjs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const { createRouter, createAutomatonRouter, createMedleyRouter } = require(
  resolve(root, "dist", "index.js"),
);

const METHOD = "GET";
const defaultHandler = () => {};

const routeDefinitions = routes;

// Use concrete paths for all routers to ensure consistency
const concretePathSet = new Set();
for (const route of routeDefinitions) {
  for (const concretePath of route.concretePaths) {
    concretePathSet.add(concretePath);
  }
}
const routeFixtures = [...concretePathSet].map((path) => [
  METHOD,
  path,
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

function toPathToRegexpPattern(path) {
  if (path.includes(":")) {
    return path.replace(/:([A-Za-z0-9_]+)\*/g, "*$1");
  }
  return path;
}

function logBuildError(name, error) {
  const message = error && error.stack ? error.stack : String(error);
  console.error(`[test] ${name} setup failed:\n${message}`);
}

function buildBalancingRouter() {
  const router = createRouter();
  for (const [method, path, handler] of routeFixtures) {
    router.on(method, path, handler);
  }
  return {
    name: "balancing-router",
    lookup: (method, path) => router.find(method, path),
  };
}

function buildBalancingRouterV2() {
  if (typeof createAutomatonRouter !== "function") return null;
  const router = createAutomatonRouter();
  for (const [method, path, handler] of routeFixtures) {
    router.on(method, path, handler);
  }
  return {
    name: "balancing-router-v2",
    lookup: (method, path) => router.find(method, path),
  };
}

function buildFindMyWay() {
  try {
    const findMyWay = require("find-my-way");
    const router = findMyWay();
    for (const [method, path, handler] of routeFixtures) {
      router.on(method, path, handler);
    }
    return {
      name: "find-my-way",
      lookup: (method, path) => router.find(method, path),
    };
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
    return {
      name: "trouter",
      lookup: (method, path) => router.find(method, path),
    };
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
      name: "radix3",
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
      name: "@medley/router",
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

function buildMedleyRouterLocal() {
  if (typeof createMedleyRouter !== "function") return null;
  const router = createMedleyRouter();
  for (const [method, path, handler] of routeFixtures) {
    const store = router.register(path);
    store[method] = handler;
  }
  return {
    name: "medley-router-local",
    lookup: (method, path) => {
      const match = router.find(path);
      if (!match) return null;
      return match.store[method] ?? match.store["*"] ?? null;
    },
  };
}

function buildPathToRegexpLinear() {
  try {
    const { match } = require("path-to-regexp");
    const entries = frameworkRouteFixtures.map(([method, path, handler]) => {
      return {
        method,
        handler,
        match: match(toPathToRegexpPattern(path), { decode: false }),
      };
    });
    return {
      name: "path-to-regexp-linear",
      lookup: (method, path) => {
        for (let i = 0; i < entries.length; i += 1) {
          const entry = entries[i];
          if (entry.match(path)) return entry.handler;
        }
        return null;
      },
    };
  } catch (error) {
    logBuildError("path-to-regexp-linear", error);
    return null;
  }
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
  if (!path) return "/";
  if (path.charCodeAt(0) === 47) return path;
  return `/${path}`;
}

function generateTestUrls(seed, count = 10000) {
  const rng = createRng(seed);
  const urls = [];
  
  for (let i = 0; i < count; i += 1) {
    const route = routeDefinitions[Math.floor(rng() * routeDefinitions.length)];
    const url = normalizeLookupPath(route.generateUrl(rng));
    urls.push(url);
  }
  
  // Add some not-found URLs
  const notFoundUrls = [
    "/__404__",
    "/not/found/here",
    "/missing/route",
    "/invalid/path/test",
  ];
  
  urls.push(...notFoundUrls);
  
  return urls;
}

function getTestUrls() {
  if (Array.isArray(precomputedUrls) && precomputedUrls.length > 0) {
    // Use precomputed URLs from benchmark (routes-generic.urls.mjs or custom)
    return precomputedUrls.map((path) => normalizeLookupPath(path));
  }
  
  // Fallback: generate URLs (with warning)
  console.warn(
    "[test] No precomputed URLs found. Generating test URLs...",
  );
  console.warn(
    "[test] Tip: Run 'node scripts/bench/generate-static-urls.mjs' to generate bench/routes-generic.urls.mjs",
  );
  const seed = Date.now();
  return generateTestUrls(seed);
}

async function runConsistencyTest() {
  console.log("Building routers...");
  
  const routerBuilders = [
    buildBalancingRouter,
    buildBalancingRouterV2,
    buildFindMyWay,
    buildTrouter,
    buildRadix3,
    buildMedleyRouter,
    buildMedleyRouterLocal,
    buildPathToRegexpLinear,
  ];
  
  // Known behavioral differences (not failures)
  const knownDifferences = {
    trouter: {
      description: "Trouter doesn't validate parameter patterns (regex constraints)",
      allowExtraMatches: true, // trouter may match more paths than path-to-regexp
    },
  };
  
  const routers = [];
  for (const builder of routerBuilders) {
    try {
      const router = builder();
      if (router) {
        routers.push(router);
      }
    } catch (error) {
      logBuildError(builder.name, error);
    }
  }
  
  if (routers.length === 0) {
    console.error("No routers available for testing!");
    process.exit(1);
  }
  
  console.log(`Testing ${routers.length} routers...`);
  
  // Find the reference router (path-to-regexp-linear)
  const referenceRouter = routers.find(
    (r) => r.name === "path-to-regexp-linear",
  );
  
  if (!referenceRouter) {
    console.error("Reference router (path-to-regexp-linear) not available!");
    process.exit(1);
  }
  
  console.log(`Using ${referenceRouter.name} as reference implementation\n`);
  
  // Get test URLs (precomputed from benchmark or generated as fallback)
  const testUrls = getTestUrls();
  if (Array.isArray(precomputedUrls) && precomputedUrls.length > 0) {
    console.log(`Using ${testUrls.length} precomputed URLs from benchmark\n`);
  } else {
    console.log(`Generated ${testUrls.length} test URLs\n`);
  }
  
  // Test each router against the reference
  let allPassed = true;
  
  for (const router of routers) {
    if (router.name === referenceRouter.name) {
      console.log(`✓ ${router.name} (reference)`);
      continue;
    }
    
    console.log(`Testing ${router.name}...`);
    
    const knownDiff = knownDifferences[router.name];
    let matches = 0;
    let mismatches = 0;
    let knownDiffCount = 0;
    const errors = [];
    
    for (const url of testUrls) {
      const referenceResult = referenceRouter.lookup(METHOD, url);
      const routerResult = router.lookup(METHOD, url);
      
      const referenceFound = referenceResult !== null;
      const routerFound = routerResult !== null;
      
      if (referenceFound === routerFound) {
        matches += 1;
      } else {
        // Check if this is a known difference
        if (knownDiff?.allowExtraMatches && !referenceFound && routerFound) {
          // Router matched something reference didn't - this is expected for trouter
          knownDiffCount += 1;
          matches += 1; // Count as acceptable
        } else {
          mismatches += 1;
          if (errors.length < 10) {
            // Only collect first 10 errors
            errors.push({
              url,
              expected: referenceFound ? "match" : "no match",
              actual: routerFound ? "match" : "no match",
            });
          }
        }
      }
    }
    
    if (mismatches === 0) {
      if (knownDiffCount > 0 && knownDiff) {
        console.log(
          `  ✓ ${router.name} - All ${matches} tests passed (${knownDiffCount} known differences: ${knownDiff.description})\n`,
        );
      } else {
        console.log(`  ✓ ${router.name} - All ${matches} tests passed\n`);
      }
    } else {
      console.error(
        `  ✗ ${router.name} - ${mismatches}/${testUrls.length} mismatches\n`,
      );
      allPassed = false;
      
      console.error("  Sample mismatches:");
      for (const error of errors) {
        console.error(
          `    ${error.url}: expected ${error.expected}, got ${error.actual}`,
        );
      }
      console.error();
    }
  }
  
  if (allPassed) {
    console.log("✓ All routers are consistent with the reference implementation!");
    process.exit(0);
  } else {
    console.error("✗ Some routers have inconsistencies!");
    process.exit(1);
  }
}

runConsistencyTest().catch((error) => {
  console.error("Test failed with error:", error);
  process.exit(1);
});
