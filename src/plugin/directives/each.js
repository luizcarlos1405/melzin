import { joinPath } from "../helpers/joinPath";
import { getElementDataPath } from "../helpers/getElementDataPath";
import { getAt } from "../helpers/getAt";
import { setAt } from "../helpers/setAt";

export const eachDirective = (el, { expression }, { evaluate }) => {
  const [valuePath, ...defaultValueExpressionParts] =
    expression.split(/\s*:\s*/);
  const defaultValueExpression = defaultValueExpressionParts.join(":");

  const elementDataPath = getElementDataPath(el);
  const arrayPath = joinPath(elementDataPath, valuePath);

  const currentValue = getAt(arrayPath);
  const defaultValue = defaultValueExpression
    ? evaluate(defaultValueExpression, [])
    : [];
  const value = currentValue ?? defaultValue;

  if (currentValue == null) {
    setAt(arrayPath, value);
  }

  const firstChild = el.content.children[0];
  firstChild.setAttribute("data-path", `${arrayPath}`);
  firstChild.setAttribute("data-is-each-item", "true");

  el.setAttribute(":key", `$id('${arrayPath}')`);

  Alpine.nextTick(() => {
    el.setAttribute("x-for", `($item, $index) in $get('${arrayPath}')`);
  });
};
