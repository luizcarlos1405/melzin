import { componentDirective } from "./directives/component";
import { syncDirective } from "./directives/sync";
import { eachDirective } from "./directives/each";
import { pathDirective } from "./directives/path";
import { handlerDirective } from "./directives/handler";
import { xImport } from "./web-components/x-import";
import { xRoute } from "./web-components/x-route";
import { xOnly } from "./web-components/x-only";
import { exposeDevHelpers } from "./debug/exposeDevHelpers";
import get from "lodash/get";

export const plugin = (Alpine) => {
  window.Alpine = Alpine;

  // Web components
  Alpine.components = {};

  xRoute();
  xImport();
  xOnly();

  // State
  const state = Alpine.reactive({ root: undefined });
  Alpine.app = {
    state,
    handlers: {},
    registeredRoutes: {},
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
  Alpine.directive("sync", syncDirective);
  Alpine.directive("each", eachDirective).before("for");
  Alpine.directive("component", componentDirective);
  Alpine.directive("path", pathDirective).before("sync");
  Alpine.directive("handler", handlerDirective);

  // Magics
  Alpine.magic("get", () => (path) => get(Alpine.app.state, path));
  Alpine.magic("state", () => Alpine.app.state);

  // Debugging
  exposeDevHelpers(Alpine);
};
