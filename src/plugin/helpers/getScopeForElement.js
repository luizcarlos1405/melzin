import { isCreatedByEachDirective } from "./isCreatedByEachDirective";
import { joinPath } from "./joinPath";

export const getElementDataPath = (el) => {
  const elementDataPath =
    el.dataset?.scope || el.closest("[data-scope]")?.dataset?.scope || "";

  if (isCreatedByEachDirective(el)) {
    const indexPath = Alpine.evaluate(el, "$index");
    return joinPath(elementDataPath, indexPath);
  }

  return elementDataPath;
};
