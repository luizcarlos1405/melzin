import get from "lodash/get";
import { joinPath } from "../helpers/joinPath";
import set from "lodash/set";
import { getScopeForElement } from "../helpers/getScopeForElement";
import { isCreatedByEachDirective } from "../helpers/isCreatedByEachDirective";

export const propDirective = (
  el,
  { expression: stringPaths, modifiers: bindProperties },
  { evaluate, effect },
) => {
  const props = stringPaths.split(/\s*,\s*/);
  props.forEach((prop) => {
    // TODO: Allow stringPath to contain a path like "foo.bar"
    const [propPath, defaultValueExpression] = prop.split(/\s*:\s*/);

    if (!propPath) {
      return;
    }

    const scopePath = getScopeForElement(el);
    const valuePath = joinPath(scopePath, propPath);

    const isLeafElement = el.children.length === 0;

    const initialPropertyValue = getInitialPropertyValue(el, bindProperties);
    const defaultValue = defaultValueExpression
      ? evaluate(defaultValueExpression)
      : null;

    reactToEvents(el, propPath);

    // Reactivilly create set value into innerText when needed
    effect(() => {
      const currentValue = get(Alpine.app.state, valuePath);
      const newValue = currentValue ?? defaultValue ?? initialPropertyValue;

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

const reactToEvents = (el, stringPath) => {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    el.addEventListener("input", () => {
      const scopePath = getScopeForElement(el);
      const valuePath = joinPath(scopePath, stringPath);
      set(Alpine.app.state, valuePath, el.value);
    });
  }
};

const observeAtributes = (el, attributeNames, callback) =>
  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (
        mutation.type === "attributes" &&
        attributeNames.includes(mutation.attributeName)
      ) {
        callback(mutation);
      }
    });
  }).observe(el, {
    attributes: true, //configure it to listen to attribute changes
  });

const getInitialPropertyValue = (el, bindProperties) => {
  const [propKey] = bindProperties;

  if (propKey) {
    return el[propKey];
  }

  if (
    el.tagName === "SELECT" ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA"
  ) {
    return el.value;
  }

  if (el.tagName === "SELECT") {
    return el.value || el.options[0]?.value;
  }

  const isLeafElement = el.children.length === 0;

  if (isLeafElement) {
    return el.innerText;
  }
};
