export type RouteHandler = (req: any, res: any, params: Record<string, string>) => any;

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
  store?: any;
}

export interface RouterOptions {
  rebalanceInterval?: number;
}

export class Router {
  constructor(options?: RouterOptions);
  on(method: string | string[], path: string | RegExp, handler: RouteHandler, store?: any): this;
  find(method: string, path: string): RouteMatch | null;
  rebalance(): void;
}

export function createRouter(options?: RouterOptions): Router;
