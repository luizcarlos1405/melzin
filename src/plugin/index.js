import { componentDirective } from "./directives/component";
import { propDirective } from "./directives/prop";
import { scanStructure } from "./helpers/scanStructure";
import "./web-components/x-import";
import { eachDirective } from "./directives/each";

export const plugin = (Alpine) => {
  Alpine.components = {};

  // Data exposing
  const app = Alpine.reactive({});
  Alpine.app = app;
  Alpine.scanStructure = scanStructure;

  // Directives
  Alpine.directive("prop", propDirective);
  Alpine.directive("each", eachDirective).before("for");
  Alpine.directive("component", componentDirective);
};
