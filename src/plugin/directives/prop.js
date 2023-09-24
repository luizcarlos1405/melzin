export const propDirective = (
  el,
  { expression: stringPath, modifiers: bindProperties },
  { evaluate, evaluateLater },
) => {
  const props = stringPath.split(/\s*,\s*/);
  props.forEach((prop) => {
    // TODO: Allow stringPath to contain a path like "foo.bar"
    const [stringPath, defaultValueExpression] = prop.split(/\s*:\s*/);

    if (!stringPath) {
      return;
    }

    const isLeafElement = el.children.length === 0;

    const defaultValue = defaultValueExpression
      ? evaluate(defaultValueExpression)
      : isLeafElement
      ? el.innerText
      : null;

    // Reactivilly create set value into innerText when needed
    const getData = evaluateLater("$data");
    Alpine.effect(() => {
      getData((data) => {
        if (data && data[stringPath] == null) {
          data[stringPath] = defaultValue;
        }

        const value = data[stringPath];

        if (value != null) {
          if (
            !bindProperties.length &&
            isLeafElement &&
            !el.hasAttribute("x-text") &&
            el.tagName !== "INPUT" &&
            el.tagName !== "TEXTAREA"
          ) {
            el.innerText = value;
          }

          bindProperties.forEach((propName) => {
            el[propName] = value;
          });

          return;
        }

        data[stringPath] = defaultValue;
      });
    });
  });
};
