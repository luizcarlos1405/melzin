const wrapExpressionInSatateScope = function (expression) {
  return `(() => {
      let { ${Object.keys(Alpine.app.state).join(", ")} } = Alpine.app.state;
      return (${expression});
    })()
  `;
};

export const evaluateWithDefault = (
  el,
  expression,
  defaultValueExpression = "null",
) =>
  Alpine.evaluate(
    el,
    `(() => {
      try {
        return ${wrapExpressionInSatateScope(expression)}
      } catch {
        return ${wrapExpressionInSatateScope(defaultValueExpression)}
      }
    })()`,
  );

window.evaluateWithDefault = evaluateWithDefault;
