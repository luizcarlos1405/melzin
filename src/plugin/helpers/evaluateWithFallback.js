export const evaluateWithFallback = (el, expression, fallback = null) => {
  const validExpression = expression === "" ? "undefined" : expression;

  return (
    Alpine.evaluate(
      el,
      `(() => {
        try {
          return ${validExpression};
        } catch {}
      })()`,
    ) ?? fallback
  );
};
