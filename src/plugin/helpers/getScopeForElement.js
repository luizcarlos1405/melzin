import { isCreatedByEachDirective } from "./isCreatedByEachDirective";
import { joinPath } from "./joinPath";

export const getScopeForElement = (el) => {
  const dataSetScope =
    el.dataset?.scope || el.closest("[data-scope]")?.dataset?.scope || "";

  if (isCreatedByEachDirective(el)) {
    const indexPath = Alpine.evaluate(el, "$index");
    return joinPath(dataSetScope, indexPath);
  }

  return dataSetScope;
};
