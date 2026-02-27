const baseOption = ["catalog", "portal"];
const locales = ["en-GB", "en-US", "de-DE", "fr-FR"];
const categories = ["alpha", "beta", "gamma", "delta", "omega"];
const pages = ["featured", "latest", "popular", "trending"];
const regions = ["north", "south", "east", "west"];
const flowGroups = ["standard", "priority", "scheduled"];
const dateValues = ["2026-01-01", "2026-02-15", "2026-03-20"];
const requestTokens = ["1122-3344-12", "5544-3322-100", "8899-0001-2222"];

function pick(array, rng) {
  return array[Math.floor(rng() * array.length)];
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function randomId(rng) {
  return String(randInt(rng, 1, 9999999));
}

function withBaseAndOptionalLocale(rng) {
  const base = pick(baseOption, rng);
  const locale = rng() < 0.5 ? `/${pick(locales, rng)}` : "";
  return `/${base}${locale}`;
}

function parseParamSegment(segment) {
  if (!segment.startsWith(":")) return null;
  const optional = segment.endsWith("?");
  const core = optional ? segment.slice(0, -1) : segment;
  const start = core.indexOf("(");
  if (start === -1) {
    return { name: core.slice(1), pattern: null, optional };
  }
  const end = core.lastIndexOf(")");
  return {
    name: core.slice(1, start),
    pattern: core.slice(start + 1, end),
    optional,
  };
}

function renderParamSegment(param) {
  if (param.pattern) return `:${param.name}(${param.pattern})`;
  return `:${param.name}`;
}

function expandPathPattern(pathPattern) {
  if (pathPattern === "/") return ["/"];
  let variants = [[]];
  const segments = pathPattern.split("/").slice(1);
  for (const segment of segments) {
    if (!segment) continue;
    if (segment.startsWith("(") && segment.endsWith(")")) {
      const choices = segment.slice(1, -1).split("|");
      const next = [];
      for (const variant of variants) {
        for (const choice of choices) next.push([...variant, choice]);
      }
      variants = next;
      continue;
    }
    const parsed = parseParamSegment(segment);
    if (parsed && parsed.optional) {
      const required = renderParamSegment({ ...parsed, optional: false });
      const next = [];
      for (const variant of variants) {
        next.push([...variant]);
        next.push([...variant, required]);
      }
      variants = next;
      continue;
    }
    for (const variant of variants) variant.push(segment);
  }
  const deduped = new Set(variants.map((parts) => `/${parts.join("/")}`));
  return [...deduped];
}

const baseRoutes = [
  {
    path: "/",
    count: 1_220_000,
    generateUrl: (rng) => (rng() < 0.5 ? "/" : ""),
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?",
    count: 658_000,
    generateUrl: (rng) => withBaseAndOptionalLocale(rng),
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/lists/:group/:list/:category",
    count: 250_000,
    generateUrl: (rng) => {
      return `${withBaseAndOptionalLocale(rng)}/lists/${pick(flowGroups, rng)}/${pick(pages, rng)}/${pick(categories, rng)}`;
    },
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved",
    count: 32_000,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/saved`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/sites/:siteId/items/:itemId",
    count: 1,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/sites/${randomId(rng)}/items/${randomId(rng)}`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests",
    count: 189_000,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/requests`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests/:requestId/receipt",
    count: 1,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/requests/${randomId(rng)}/receipt`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests/:requestId/handoff",
    count: 1,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/requests/${randomId(rng)}/handoff`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests/id/:requestId(\\d{4}-\\d{4}-\\d{2,4}|\\d+)",
    count: 1,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/requests/id/${rng() < 0.5 ? pick(requestTokens, rng) : randomId(rng)}`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests/:requestId/retry",
    count: 1,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/requests/${randomId(rng)}/retry`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests/:requestId/retry/:flowGroup",
    count: 1,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/requests/${randomId(rng)}/retry/${pick(flowGroups, rng)}`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests/:requestId/status/:statusId",
    count: 1,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/requests/${randomId(rng)}/status/${randomId(rng)}`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests/recent",
    count: 1,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/requests/recent`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests/history",
    count: 1,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/requests/history`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/requests/upcoming",
    count: 1,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/requests/upcoming`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/items/:itemId?",
    count: 3_950_000,
    generateUrl: (rng) => {
      const base = `${withBaseAndOptionalLocale(rng)}/items`;
      return rng() < 0.65 ? `${base}/${randomId(rng)}` : base;
    },
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/offers",
    count: 239_000,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/offers`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/offers/:list",
    count: 1,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/offers/${pick(pages, rng)}-${pick(categories, rng)}`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/feedback/create/items/:itemId?",
    count: 128_000,
    generateUrl: (rng) => {
      const base = `${withBaseAndOptionalLocale(rng)}/feedback/create/items`;
      return rng() < 0.65 ? `${base}/${randomId(rng)}` : base;
    },
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/discover",
    count: 644_000,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/discover`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/browse/:categories",
    count: 913_000,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/browse/${pick(categories, rng)}-${pick(categories, rng)}`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/windows",
    count: 14_000,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/windows`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/windows/pickup/:date?",
    count: 3_470,
    generateUrl: (rng) => {
      const base = `${withBaseAndOptionalLocale(rng)}/windows/pickup`;
      return rng() < 0.6 ? `${base}/${pick(dateValues, rng)}` : base;
    },
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/windows/dropoff/:date?",
    count: 32_000,
    generateUrl: (rng) => {
      const base = `${withBaseAndOptionalLocale(rng)}/windows/dropoff`;
      return rng() < 0.6 ? `${base}/${pick(dateValues, rng)}` : base;
    },
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/windows/instant",
    count: 7_230,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/windows/instant`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/basket",
    count: 133_000,
    generateUrl: (rng) => `${withBaseAndOptionalLocale(rng)}/basket`,
  },
  {
    path: "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/region/:regionName",
    count: 141_000,
    generateUrl: (rng) =>
      `${withBaseAndOptionalLocale(rng)}/region/${pick(regions, rng)}`,
  },
  {
    path: "/01/:gtin/:batchCode/:lotNumber",
    count: 0,
    generateUrl: (rng) => {
      return `/01/${randomId(rng)}/${randomId(rng)}/${randomId(rng)}`;
    },
  },
  {
    path: "/catalog/:locale([a-z]{2}-[A-Z]{2})?/requests/return-note/:returnRequestNo",
    count: 1,
    generateUrl: (rng) =>
      `/catalog${rng() < 0.5 ? `/${pick(locales, rng)}` : ""}/requests/return-note/${randomId(rng)}`,
  },
  {
    path: "/guides/:locale([a-z]{2}-[A-Z]{2})?",
    count: 0,
    generateUrl: (rng) =>
      `/guides${rng() < 0.5 ? `/${pick(locales, rng)}` : ""}`,
  },
  {
    path: "/portal/:locale([a-z]{2}-[A-Z]{2})?/vendor/:vendorName",
    count: 4_920,
    generateUrl: (rng) =>
      `/portal${rng() < 0.5 ? `/${pick(locales, rng)}` : ""}/vendor/${pick(categories, rng)}-${pick(categories, rng)}`,
  },
  {
    path: "/portal/:locale([a-z]{2}-[A-Z]{2})?/collection/:categories",
    count: 1,
    generateUrl: (rng) =>
      `/portal${rng() < 0.5 ? `/${pick(locales, rng)}` : ""}/collection/${pick(categories, rng)}-${pick(categories, rng)}`,
  },
  {
    path: "/portal/:locale([a-z]{2}-[A-Z]{2})?/page/:page",
    count: 30_400,
    generateUrl: (rng) =>
      `/portal${rng() < 0.5 ? `/${pick(locales, rng)}` : ""}/page/${pick(pages, rng)}`,
  },
  {
    path: "/portal/:locale([a-z]{2}-[A-Z]{2})?/partners/:partnerId",
    count: 10_500,
    generateUrl: (rng) =>
      `/portal${rng() < 0.5 ? `/${pick(locales, rng)}` : ""}/partners/${randomId(rng)}`,
  },
];

export const routes = baseRoutes.map((route) => ({
  path: route.path,
  count: Number(route.count),
  concretePaths: expandPathPattern(route.path),
  generateUrl: route.generateUrl,
}));
