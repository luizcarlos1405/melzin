import { evaluateWithDefault } from "./evaluateWithDefault";

export const getScopeForElement = (el) => {
  const isCreatedByEachDirective = evaluateWithDefault(
    el,
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
