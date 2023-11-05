import { componentDirective } from "./directives/component";
import { valueDirective } from "./directives/value";
import { eachDirective } from "./directives/each";
import { pathDirective } from "./directives/path";
import { handleDirective } from "./directives/handle";
import { xImport } from "./web-components/x-import";
import { xRoute } from "./web-components/x-route";
import { xOnly } from "./web-components/x-only";
import { xDevtools } from "./web-components/x-devtools";
import { exposeDevHelpers } from "./debug/exposeDevHelpers";
import { elementGet } from "./helpers/elementGet";

export const plugin = (Alpine) => {
  // Web components
  Alpine.components = {};

  xRoute();
  xImport();
  xOnly();

  // State
  const state = Object.seal(Alpine.reactive({ root: undefined }));
  Alpine.app = {
    state,
    handlers: {},
    registeredRoutes: {},
    syncedPaths: {},
    route: {
      path: location.pathname,
      query: new URLSearchParams(location.search),
      hash: location.hash,
      goto: (path) => {
        history.pushState({}, "", path);
        Alpine.app.route.path = path;
        Alpine.app.route.query = new URLSearchParams(location.search);
        Alpine.app.route.hash = location.hash;

        const event = new CustomEvent("routeChanged", {
          detail: {
            path,
            query: Alpine.app.route.query,
            hash: Alpine.app.route.hash,
          },
        });
        document.dispatchEvent(event);
      },
    },
  };

  // Directives
  Alpine.directive("value", valueDirective).before("show");
  Alpine.directive("each", eachDirective).before("for");
  Alpine.directive("component", componentDirective);
  Alpine.directive("path", pathDirective).before("value");
  Alpine.directive("handle", handleDirective);

  // Magics
  Alpine.magic("get", (el) => (path) => elementGet(el, path));
  Alpine.magic("state", () => Alpine.app.state);
  Alpine.magic("route", () => Alpine.app.route);
  Alpine.magic("value", (el) => elementGet(el));
};

export const devtools = (Alpine) => {
  // Debugging
  exposeDevHelpers(Alpine);
  xDevtools();
};
