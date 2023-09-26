import { isCreatedByEachDirective } from "./isCreatedByEachDirective";

export const getScopeForElement = (el) => {
  const dataSetScope =
    el.dataset?.scope || el.closest("[data-scope]")?.dataset?.scope || "";

  if (isCreatedByEachDirective(el)) {
    return dataSetScope;
  }

  return dataSetScope;
};
