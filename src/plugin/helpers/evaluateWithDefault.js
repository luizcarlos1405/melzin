const wrapExpressionWithState = function (expression) {
  return `(() => {
      let { ${Object.keys(Alpine.app.state).join(", ")} } = Alpine.app.state;
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
