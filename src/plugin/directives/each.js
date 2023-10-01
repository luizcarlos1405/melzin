import { joinPath } from "../helpers/joinPath";
import { getElementDataPath } from "../helpers/getElementDataPath";
import { declareValueAt } from "../helpers/declareValueAt";

export const eachDirective = (el, { expression }, { evaluate }) => {
  const [valuePath, ...defaultValueExpressionParts] =
    expression.split(/\s*:\s*/);
  const defaultValueExpression = defaultValueExpressionParts.join(":");

  const elementDataPath = getElementDataPath(el);
  const arrayPathFromRoot = joinPath(elementDataPath, valuePath);
  const defaultValue = defaultValueExpression
    ? evaluate(defaultValueExpression, [])
    : [];

  declareValueAt(arrayPathFromRoot, defaultValue, { el });

  const firstChild = el.content.children[0];
  firstChild.setAttribute("data-path", `${arrayPathFromRoot}`);
  firstChild.setAttribute("data-is-each-item", "true");

  el.setAttribute(":key", `$id('${arrayPathFromRoot}')`);

  Alpine.nextTick(() => {
    el.setAttribute(
      "x-for",
      `($item, $index) in $getAt('${arrayPathFromRoot}')`,
    );
  });
};
