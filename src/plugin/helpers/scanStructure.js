import set from "lodash/set";
import get from "lodash/get";
import { evaluateWithState } from "./evaluateWithState";
import { joinPath } from "./joinPath";
import { isCreatedByEachDirective } from "./isCreatedByEachDirective";

const declareValueAt = (
  structure,
  valuePathFromRoot = "",
  defaultValue = null,
) => {
  const currentValue = get(structure, valuePathFromRoot);
  if (currentValue === undefined) {
    set(structure, joinPath("root", valuePathFromRoot), defaultValue);
  }
};

// Specific for scanning, hardcode index to 0
const getElementDataPath = (el) => {
  const elementDataPath =
    el.dataset?.path || el.closest("[data-path]")?.dataset?.path || "";

  if (isCreatedByEachDirective(el)) {
    return joinPath(elementDataPath, "0");
  }

  return elementDataPath;
};

export const scanStructure = (rootElement, structure = {}) => {
  rootElement ||= document.body;

  Alpine.walk(rootElement, (el, skip) => {
    const elementDataPath = getElementDataPath(el);

    const xValue = el.getAttribute("x-value");
    if (xValue) {
      const [valuePath, ...defaultValueExpressionParts] = xValue
        ? xValue.split(":")
        : [];
      const defaultValueExpression = defaultValueExpressionParts.join(":");
      const defaultValue = evaluateWithState(el, defaultValueExpression);

      const valuePathFromRoot = joinPath(elementDataPath, valuePath);
      declareValueAt(structure, valuePathFromRoot, defaultValue);
      return;
    }

    const hasXEach = el.hasAttribute("x-each");
    if (hasXEach) {
      const xEach = el.getAttribute("x-each");
      const [arrayPath = "", ...defaultEachExpressionParts] = xEach
        ? xEach.split(":")
        : [];
      const defaultValueExpression = defaultEachExpressionParts.join(":");
      const defaultValue = evaluateWithState(el, defaultValueExpression, [
        null,
      ]);

      const valuePathFromRoot = joinPath(elementDataPath, arrayPath);

      declareValueAt(structure, valuePathFromRoot, defaultValue);

      Array.from(el.content.children).forEach((childElement) => {
        scanStructure(childElement, structure);
      });
    }
  });

  return structure.root;
};
