import get from "lodash/get";
import { joinPath } from "../helpers/joinPath";
import set from "lodash/set";
import { getScopeForElement } from "../helpers/getScopeForElement";
import { isCreatedByEachDirective } from "../helpers/isCreatedByEachDirective";

export const propDirective = (
  el,
  { expression: stringPath, modifiers: bindProperties },
  { evaluate, effect },
) => {
  const props = stringPath.split(/\s*,\s*/);
  props.forEach((prop) => {
    // TODO: Allow stringPath to contain a path like "foo.bar"
    const [stringPath, defaultValueExpression] = prop.split(/\s*:\s*/);

    if (!stringPath) {
      return;
    }

    const scopePath = getScopeForElement(el);
    const indexPath = isCreatedByEachDirective(el) ? evaluate("$index") : "";
    const valuePath = joinPath(scopePath, indexPath, stringPath);

    const isLeafElement = el.children.length === 0;

    const defaultValue = defaultValueExpression
      ? evaluate(defaultValueExpression)
      : isLeafElement
      ? el.innerText
      : null;

    // Reactivilly create set value into innerText when needed
    effect(() => {
      const currentValue = get(Alpine.app.state, valuePath);
      const newValue = currentValue ?? defaultValue;

      if (currentValue == null) {
        set(Alpine.app.state, valuePath, newValue);
      }

      if (
        !bindProperties.length &&
        isLeafElement &&
        !el.hasAttribute("x-text") &&
        el.tagName !== "INPUT" &&
        el.tagName !== "TEXTAREA"
      ) {
        el.innerText = newValue;
      }

      bindProperties.forEach((propName) => {
        el[propName] = newValue;
      });
    });
  });
};
