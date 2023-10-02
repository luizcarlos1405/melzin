import { getAt } from "./getAt";

const wrapExpressionWithState = function (expression) {
  const stateRoot = getAt();
  const obj =
    typeof stateRoot === "object" && stateRoot !== null ? stateRoot : {};
  return `(() => {
      let { ${Object.keys(obj).join(", ")} } = Alpine.app.state;
      return ${expression};
    })()
  `;
};

export const evaluateWithState = (el, expression, defaultValue = null) =>
  Alpine.evaluate(
    el,
    wrapExpressionWithState(`(() => {
      try {
        return ${expression === "" ? "undefined" : expression};
      } catch {}
    })()`),
  ) ?? defaultValue;

window.evaluateWithState = evaluateWithState;
