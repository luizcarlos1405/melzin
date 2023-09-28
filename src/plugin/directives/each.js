import get from "lodash/get";
import set from "lodash/set";
import { joinPath } from "../helpers/joinPath";
import { getScopeForElement } from "../helpers/getScopeForElement";

export const eachDirective = (el, { expression }, { evaluate }) => {
  const [stringPath, ...defaultValueExpressionParts] =
    expression.split(/\s*:\s*/);
  const defaultValueExpression = defaultValueExpressionParts.join(":");

  const scopePath = getScopeForElement(el);
  const arrayPath = joinPath(scopePath, stringPath);

  const currentValue = get(Alpine.app.state, arrayPath);
  const defaultValue = defaultValueExpression
    ? evaluate(defaultValueExpression, [])
    : [];
  const value = currentValue ?? defaultValue;

  if (currentValue == null) {
    set(Alpine.app.state, arrayPath, value);
  }

  const firstChild = el.content.children[0];
  firstChild.setAttribute("data-scope", `${arrayPath}`);
  firstChild.setAttribute("data-is-each-item", "true");

  el.setAttribute(":key", `$id('${arrayPath}')`);
  Alpine.nextTick(() => {
    el.setAttribute(
      "x-for",
      `($item, $index) in get(Alpine.app.state, '${arrayPath}')`,
    );
  });
};
