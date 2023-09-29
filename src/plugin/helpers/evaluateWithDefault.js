import { getAt } from "./getAt";

const wrapExpressionWithState = function (expression) {
  const stateRoot = getAt();
  const obj =
    typeof stateRoot === "object" && stateRoot !== null ? stateRoot : {};
  return `(() => {
      let { ${Object.keys(obj).join(", ")} } = Alpine.app.state;
      return (${expression});
    })()
  `;
};

export const evaluateWithState = (
  el,
  expression,
  defaultValueExpression = "null",
) =>
  Alpine.evaluate(
    el,
    `(() => {
      try {
        return ${wrapExpressionWithState(expression)}
      } catch {
        return ${wrapExpressionWithState(defaultValueExpression)}
      }
    })()`,
  );

window.evaluateWithState = evaluateWithState;
