import forEach from "lodash/forEach";
import merge from "lodash/merge";
import set from "lodash/set";
import { propsStringToObject } from "./propsStringToObject";
import { evaluateWithState } from "./evaluateWithDefault";
import { joinPath } from "./joinPath";
import { isCreatedByEachDirective } from "./isCreatedByEachDirective";

const structuresFromComponentTemplate = (component) =>
  merge(...Array.from(component.template.content.children).map(scanStructure));

const structureFromTemplate = (template) => {
  const childStructures = Array.from(template.content.children).flatMap(
    (childElement) => {
      const component = Alpine.components[childElement.tagName];
      if (component) {
        return structuresFromComponentTemplate(component);
      }

      return scanStructure(childElement);
    },
  );
  return merge({}, ...childStructures);
};

const structuresFromEachDirectiveTemplate = (eachDirective) => {
  const childStructure = structureFromTemplate(eachDirective);
  const newArray = [childStructure];
  newArray.isEach = true;

  return newArray;
};

export const scanStructure = (rootElement) => {
  rootElement ||= document.body;

  const structure = {};
  const scopeStack = [{ element: rootElement, path: "" }];

  Alpine.walk(rootElement, (el, stop) => {
    const isImported = !!el.closest("x-import");

    if (isCreatedByEachDirective(el) || isImported) {
      return;
    }

    while (
      scopeStack.length > 1 &&
      !scopeStack[scopeStack.length - 1].element.contains(el)
    ) {
      scopeStack.pop();
    }

    const elementScope = el.dataset?.scope;

    if (elementScope) {
      const lastScope = scopeStack[scopeStack.length - 1];
      const newScope = {
        element: el,
        path: joinPath(lastScope.path, elementScope),
      };
      scopeStack.push(newScope);
    }

    const currentScope = scopeStack[scopeStack.length - 1];

    const isTemplate = el.tagName === "TEMPLATE";
    const isEach = isTemplate && el.hasAttribute("x-each");

    if (isEach) {
      const xEach = el.getAttribute("x-each");
      const childStructure = structuresFromEachDirectiveTemplate(el);
      set(structure, joinPath(currentScope.path, xEach), childStructure);
      return;
    }

    const xProp = el.getAttribute("x-prop");
    if (xProp) {
      const propObject = propsStringToObject(xProp) || {};
      forEach(propObject, (defaultValue, key) => {
        const value = evaluateWithState(el, "key") || defaultValue;
        set(structure, joinPath(currentScope.path, key), value);
      });
    }
  });

  window.scannedStructure = structure;
  return structure;
};
