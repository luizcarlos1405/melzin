import get from "lodash/get";
import set from "lodash/set";
import { joinPath } from "../helpers/joinPath";
import { getScopeForElement } from "../helpers/getScopeForElement";

export const eachDirective = (el, { expression: stringPath }) => {
  const scopePath = getScopeForElement(el);
  const arrayPath = joinPath(scopePath, stringPath);
  const currentValue = get(Alpine.app.state, arrayPath);
  const value = currentValue ?? [];

  if (currentValue == null) {
    set(Alpine.app.state, arrayPath, value);
  }

  const firstChild = el.content.children[0];
  firstChild.setAttribute("data-scope", `${arrayPath}`);

  el.setAttribute("x-for", `($item, $index) in Alpine.app.state.${arrayPath}`);
  el.setAttribute(":key", `$id('${arrayPath}')`);
};
