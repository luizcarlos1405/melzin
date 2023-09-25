import { joinPath } from "../helpers/joinPath";

export const scopeDirective = (el, { expression: stringPath }) => {
  const parentScopePath =
    el.dataset?.scope || el.closest("[data-scope]")?.dataset?.scope || "";
  const scopePath = joinPath(parentScopePath, stringPath);

  el.setAttribute("data-scope", `${scopePath}`);
};
