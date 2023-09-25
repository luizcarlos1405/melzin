import { componentDirective } from "./directives/component";
import { propDirective } from "./directives/prop";
import { scanStructure } from "./helpers/scanStructure";
import "./web-components/x-import";

export const plugin = (Alpine) => {
  Alpine.components = {};

  // Data exposing
  const appData = Alpine.reactive({});
  window.appData = appData;
  const appStateStructure = Alpine.reactive({});
  window.appDataStructure = appStateStructure;
  window.scanStructure = scanStructure;

  Alpine.effect(() => {
    const stateEntries = Object.entries(appData).map(([key, { getData }]) => {
      const data = getData();

      return [key, data];
    });

    window.appState = Object.fromEntries(stateEntries);
  });

  // Directives
  Alpine.directive("prop", propDirective);
  Alpine.directive("each", (el, { expression }) => {
    el.setAttribute("x-for", `($item, $index) in ${expression}`);
    el.setAttribute(":key", `$id(${expression})`);
  }).before("for");
  Alpine.directive("component", componentDirective);
};
