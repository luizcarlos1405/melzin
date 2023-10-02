import set from "lodash/set";
import get from "lodash/get";
import { evaluateWithState } from "./evaluateWithState";
import { joinPath } from "./joinPath";
import { isCreatedByEachDirective } from "./isCreatedByEachDirective";
import { getElementDataPath } from "./getElementDataPath";

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

export const scanStructure = (rootElement, structure = {}) => {
  rootElement ||= document.body;

  Alpine.walk(rootElement, (el, skip) => {
    const elementDataPath = isCreatedByEachDirective(el)
      ? joinPath(getElementDataPath(el), "0")
      : getElementDataPath(el);

    const xValue = el.getAttribute("x-value");
    if (xValue) {
      const [valuePath, ...defaultValueExpressionParts] = xValue
        ? xValue.split(":")
        : [];
      const defaultValueExpression = defaultValueExpressionParts.join(":");
      const defaultValue = evaluateWithState(el, defaultValueExpression);

      const valuePathFromRoot = joinPath(elementDataPath, valuePath);
      declareValueAt(structure, valuePathFromRoot, defaultValue);
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

  return structure;
};
