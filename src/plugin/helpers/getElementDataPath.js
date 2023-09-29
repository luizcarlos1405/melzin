import { isCreatedByEachDirective } from "./isCreatedByEachDirective";
import { joinPath } from "./joinPath";

export const getElementDataPath = (el) => {
  const elementDataPath =
    el.dataset?.path || el.closest("[data-path]")?.dataset?.path || "";

  if (isCreatedByEachDirective(el)) {
    const indexPath = Alpine.evaluate(el, "$index");
    return joinPath(elementDataPath, indexPath);
  }

  return elementDataPath;
};
