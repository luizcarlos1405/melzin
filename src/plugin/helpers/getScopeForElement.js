import { evaluateWithDefault } from "./evaluateWithDefault";

export const getScopeForElement = (el) => {
  const isCreatedByEachDirective = evaluateWithDefault(
    this,
    "{$item,$index}",
    false,
  );
  const dataSetScope =
    el.dataset?.scope || el.closest("[data-scope]")?.dataset?.scope || "";

  if (isCreatedByEachDirective) {
    return dataSetScope;
  }

  return dataSetScope;
};
