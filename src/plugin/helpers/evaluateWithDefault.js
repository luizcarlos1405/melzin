export const evaluateWithDefault = (
  el,
  expression,
  defaultValueExpression = "null",
) =>
  Alpine.evaluate(
    el,
    `(() => {
      with (Alpine.app) {
        try {
          return ${expression}
        } catch {
          return ${defaultValueExpression}
        }
      }
    })()`,
  );

window.evaluateWithDefault = evaluateWithDefault;
