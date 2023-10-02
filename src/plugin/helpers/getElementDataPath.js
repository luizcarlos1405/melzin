import { evaluateWithFallback } from "./evaluateWithFallback";
import { isCreatedByEachDirective } from "./isCreatedByEachDirective";
import { joinPath } from "./joinPath";

export const getElementDataPath = (el) => {
  const elementDataPath =
    el.dataset?.path || el.closest("[data-path]")?.dataset?.path || "";

  if (isCreatedByEachDirective(el)) {
    const indexPath = evaluateWithFallback(el, "$index");
    return indexPath != null
      ? joinPath(elementDataPath, indexPath)
      : elementDataPath;
  }

  return elementDataPath;
};
