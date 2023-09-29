import { getElementDataPath } from "../helpers/getScopeForElement";
import { joinPath } from "../helpers/joinPath";

export const scopeDirective = (el, { expression: stringPath }) => {
  const parentScopePath = getElementDataPath(el);
  const scopePath = joinPath(parentScopePath, stringPath);

  el.setAttribute("data-scope", `${scopePath}`);
};
