# balancing-router

Trie-based HTTP router with adaptive rebalancing. It supports Express-style path patterns and full RegExp routes, and tracks match frequency so you can reorder hot paths via `rebalance()`.

## API

### `createRouter(): Router`

Creates a new router instance.

### `router.on(method, path, handler, store?)`

Register a handler for one or more HTTP methods.

- `method`: string (e.g. `"GET"`) or array of strings. `"*"` registers a method wildcard.
- `path`: string route pattern or a `RegExp`.
- `handler`: `(req, res, params) => any`.
- `store`: optional metadata attached to the route, returned in matches.

### `router.find(method, path): RouteMatch | null`

Find a matching route. Returns `null` when there is no match.

`RouteMatch` shape:

- `handler`: the registered handler
- `params`: captured parameters (empty object when none)
- `store`: optional metadata passed to `on`

### `router.rebalance(): void`

Reorders dynamic branches (params, wildcards, regex routes) by observed hit counts. Call this either on an interval or after a given number of requests.

## Path Patterns

- Static: `/users`
- Params: `/users/:id` → `{ id: "42" }`
- Param with regex: `/orders/:id(\\d+)` → only digits
- Wildcard: `/files/*` → `{ "*": "a/b/c" }`
- Named wildcard: `/assets/:path*` → `{ path: "css/app.css" }`
- Regex routes: `/^\\/api\\/v\\d+\\/health$/`

Notes:

- Methods are case-insensitive and trimmed.
- Paths are normalized to start with `/`.
- If a method-specific route and a `"*"` method route both match, the specific method wins.

## Usage

```js
import { createRouter } from "balancing-router";
import http from "node:http";

const router = createRouter();

router.on("GET", "/users/:id", (req, res, params) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: params.id }));
});

router.on(["GET", "POST"], /^\/api\/v\d+\/health$/, (req, res) => {
  res.writeHead(204);
  res.end();
});

const server = http.createServer((req, res) => {
  const match = router.find(req.method ?? "GET", req.url ?? "/");
  if (!match) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  match.handler(req, res, match.params);
});

server.listen(3000);
```

## Development

- Build: `npm run build`
- Tests: `npm test`
- Router consistency: `npm run test:consistency`
- Benchmarks: `npm run bench`
- Compare to previous commit: `npm run bench:compare`
- Benchmarks replay a prebuilt, shuffled URL corpus generated from per-route `count` values in `bench/routes.mjs`.
- Rebalancing (for `balancing-router`) happens in warmup only, not during timed measurement.

### Router Consistency Test

The `npm run test:consistency` command verifies that all routers used in benchmarks produce the same routing results. It uses `path-to-regexp-linear` as a reference implementation and tests all routers against the same precomputed URLs used in benchmarks (typically 3 million URLs from `bench/routes-generic.urls.mjs`) to ensure they match correctly.

This is useful for:
- Verifying that benchmark comparisons are fair (all routers match the same routes)
- Catching routing logic bugs or regressions
- Ensuring framework compatibility
- Validating consistency across millions of route lookups

The test uses the exact same URL corpus as the benchmark script, ensuring that the consistency test validates the same scenarios being measured for performance.

You can test with custom URL sets using environment variables:
```bash
# Use routes-specific.urls.mjs instead of routes-generic.urls.mjs
BENCH_PRECOMPUTED_URLS_MODULE=./bench/routes-specific.urls.mjs npm run test:consistency

# Use custom routes and URLs
BENCH_ROUTES_MODULE=./my-routes.mjs BENCH_PRECOMPUTED_URLS_MODULE=./my-urls.mjs npm run test:consistency
```

Note: `trouter` has a known behavioral difference - it doesn't validate parameter regex patterns, so it may match more paths than other routers. This is expected and documented in the test output.
