import get from "lodash/get";
import set from "lodash/set";
import { joinPath } from "../helpers/joinPath";
import { getElementDataPath } from "../helpers/getElementDataPath";

export const eachDirective = (el, { expression }, { evaluate }) => {
  const [valuePath, ...defaultValueExpressionParts] =
    expression.split(/\s*:\s*/);
  const defaultValueExpression = defaultValueExpressionParts.join(":");

  const elementDataPath = getElementDataPath(el);
  const arrayPath = joinPath(elementDataPath, valuePath);

  const currentValue = get(Alpine.app.state, arrayPath);
  const defaultValue = defaultValueExpression
    ? evaluate(defaultValueExpression, [])
    : [];
  const value = currentValue ?? defaultValue;

  if (currentValue == null) {
    set(Alpine.app.state, arrayPath, value);
  }

  const firstChild = el.content.children[0];
  firstChild.setAttribute("data-path", `${arrayPath}`);
  firstChild.setAttribute("data-is-each-item", "true");

  el.setAttribute(":key", `$id('${arrayPath}')`);

  Alpine.nextTick(() => {
    el.setAttribute("x-for", `($item, $index) in $get('${arrayPath}')`);
  });
};
