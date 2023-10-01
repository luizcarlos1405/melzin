export const evaluateWithFallback = (el, expression, fallback) => {
  return (
    Alpine.evaluate(
      el,
      `(() => {
        try {
          return ${expression === "" ? "undefined" : expression};
        } catch {}
      })()`,
    ) || fallback
  );
};
