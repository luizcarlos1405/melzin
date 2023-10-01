import { evaluateWithFallback } from "./evaluateWithFallback";
import { isCreatedByEachDirective } from "./isCreatedByEachDirective";
import { joinPath } from "./joinPath";

export const getElementDataPath = (el) => {
  const elementDataPath =
    el.dataset?.path || el.closest("[data-path]")?.dataset?.path || "";

  const indexPath = evaluateWithFallback(el, "$index");
  if (isCreatedByEachDirective(el) && indexPath) {
    const indexPath = Alpine.evaluate(el, "$index");
    return joinPath(elementDataPath, indexPath);
  }

  return elementDataPath;
};
