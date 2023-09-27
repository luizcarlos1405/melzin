import { componentDirective } from "./directives/component";
import { propDirective } from "./directives/prop";
import { scanStructure } from "./helpers/scanStructure";
import { eachDirective } from "./directives/each";
import { scopeDirective } from "./directives/scope";
import { eventDirective } from "./directives/event";
import "./web-components/x-import";
import "./web-components/x-route";

export const plugin = (Alpine) => {
  Alpine.components = {};

  // Data exposing
  const state = Alpine.reactive({});
  Alpine.app = {
    state,
    event: {},
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
  Alpine.scanStructure = scanStructure;

  // Directives
  Alpine.directive("prop", propDirective);
  Alpine.directive("each", eachDirective);
  Alpine.directive("component", componentDirective);
  Alpine.directive("scope", scopeDirective).before("prop");
  Alpine.directive("event", eventDirective);
};
