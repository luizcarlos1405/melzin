import forEach from "lodash/forEach";
import merge from "lodash/merge";
import set from "lodash/set";
import { propsStringToObject } from "./propsStringToObject";

const joinPath = (path1, path2) => [path1, path2].filter(Boolean).join(".");

export const scanStructure = (rootElement) => {
  rootElement ||= document.body;

  const structure = {};
  const scopeStack = [{ element: rootElement, path: "" }];

  Alpine.walk(rootElement, (el, stop) => {
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
      const childStructures = Array.from(el.content.children).flatMap(
        (childElement) => {
          const component = Alpine.components[childElement.tagName];
          if (component) {
            return Array.from(component.template.content.children).map(
              scanStructure,
            );
          }

          return scanStructure(childElement);
        },
      );
      const newArray = [];
      newArray.sample = merge(...childStructures);
      newArray.isEach = true;
      set(structure, joinPath(currentScope.path, xEach), newArray);
      return;
    }

    const xProp = el.getAttribute("x-prop");

    if (xProp) {
      const propObject = propsStringToObject(xProp) || {};
      forEach(propObject, (defaultValue, key) => {
        const value =
          Alpine.evaluate(
            el,
            `(()=>{try{return ${key}}catch{return null}})()`,
          ) || defaultValue;
        set(structure, joinPath(currentScope.path, key), value);
      });
    }
  });

  window.scannedStructure = structure;
  return structure;
};
