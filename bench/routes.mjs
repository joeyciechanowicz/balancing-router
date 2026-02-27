import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { routes as genericRoutes } from "./routes-generic.mjs";

export const availableRouteSets = ["generic", "module"];

const localRoutesModule = process.env.BENCH_ROUTES_MODULE;
let moduleRoutes = null;

if (localRoutesModule) {
  const moduleUrl = localRoutesModule.startsWith(".") || localRoutesModule.startsWith("/")
    ? pathToFileURL(resolve(process.cwd(), localRoutesModule)).href
    : localRoutesModule;
  try {
    const module = await import(moduleUrl);
    if (Array.isArray(module.routes)) {
      moduleRoutes = module.routes;
    } else {
      console.warn(
        `[bench] BENCH_ROUTES_MODULE="${localRoutesModule}" has no exported "routes" array. Falling back to generic routes.`,
      );
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.warn(
      `[bench] Failed to load BENCH_ROUTES_MODULE="${localRoutesModule}": ${message}. Falling back to generic routes.`,
    );
  }
} else if (process.env.BENCH_ROUTE_SET && process.env.BENCH_ROUTE_SET !== "generic") {
  console.warn(
    `[bench] BENCH_ROUTE_SET is deprecated. Use BENCH_ROUTES_MODULE to load a local routes module.`,
  );
}

export const routeSetName = moduleRoutes ? "module" : "generic";
export const routes = moduleRoutes ?? genericRoutes;
