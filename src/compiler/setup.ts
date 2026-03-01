import type { RouteHandler } from '../index';
import { createGeneratedRouter, type GeneratedRouter } from './generated-router';

interface RouteDefinition {
  method: string | string[];
  path: string;
  handler: RouteHandler;
  store?: any;
}

export interface RouterParserOptions {
  mode?: 'generated' | 'interpreted';
}

export interface RouterParserSetup {
  add(method: string | string[], path: string, handler: RouteHandler, store?: any): RouterParserSetup;
  compile(): GeneratedRouter;
}

class RouterParserSetupImpl implements RouterParserSetup {
  private readonly _options: RouterParserOptions;
  private readonly _routes: RouteDefinition[] = [];

  constructor(options?: RouterParserOptions) {
    this._options = options ?? {};
  }

  add(method: string | string[], path: string, handler: RouteHandler, store?: any): RouterParserSetup {
    this._routes.push({
      method,
      path,
      handler,
      store,
    });
    return this;
  }

  compile(): GeneratedRouter {
    const router = createGeneratedRouter(this._options);
    for (let i = 0; i < this._routes.length; i += 1) {
      const route = this._routes[i];
      router.on(route.method, route.path, route.handler, route.store);
    }
    return router;
  }
}

export function createRouterParser(options?: RouterParserOptions): RouterParserSetup {
  return new RouterParserSetupImpl(options);
}

