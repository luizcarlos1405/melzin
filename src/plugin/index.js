import { componentDirective } from "./directives/component";
import { propDirective } from "./directives/prop";
import { scanStructure } from "./helpers/scanStructure";
import { eachDirective } from "./directives/each";
import { scopeDirective } from "./directives/scope";
import "./web-components/x-import";
import "./web-components/x-route";

export const plugin = (Alpine) => {
  Alpine.components = {};

  // Data exposing
  const state = Alpine.reactive({});
  Alpine.app = { state };
  Alpine.scanStructure = scanStructure;

  // Directives
  Alpine.directive("prop", propDirective);
  Alpine.directive("each", eachDirective);
  Alpine.directive("component", componentDirective);
  Alpine.directive("scope", scopeDirective).before("prop");
};
