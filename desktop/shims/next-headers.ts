// `next/headers` in the main process: the cookies of the request being handled, from the app's own cookie jar.
import { currentRequest } from "../main/requestScope";

export interface CookieOptions { path?: string; maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string; expires?: Date }

export async function cookies() {
  const scope = currentRequest();
  return {
    get: (name: string) => {
      const value = scope.jar.get(name, scope.path);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => scope.jar.all(scope.path),
    has: (name: string) => scope.jar.get(name, scope.path) !== undefined,
    set: (name: string, value: string, options: CookieOptions = {}) => { scope.jar.set(name, value, options); },
    delete: (name: string) => { scope.jar.delete(name); },
  };
}

export async function headers(): Promise<Headers> {
  return currentRequest().headers;
}
