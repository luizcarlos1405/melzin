import get from "lodash/get";
import { joinPath } from "../helpers/joinPath";
import set from "lodash/set";
import { getScopeForElement } from "../helpers/getScopeForElement";

export const propDirective = (
  el,
  { expression: stringPaths, modifiers: bindProperties },
  { evaluate, effect },
) => {
  const props = stringPaths.split(/\s*,\s*/);
  props.forEach((prop) => {
    // TODO: Allow stringPath to contain a path like "foo.bar"
    const [propPath, defaultValueExpression] = prop.split(/\s*:\s*/);

    if (!propPath) return;

    // Set the initial state
    const scopePath = getScopeForElement(el);
    const valuePath = joinPath(scopePath, propPath);

    const initialPropertyValue = getInitialPropertyValue(el, bindProperties);
    const defaultValue = defaultValueExpression
      ? evaluate(defaultValueExpression)
      : null;

    set(Alpine.app.state, valuePath, defaultValue ?? initialPropertyValue);

    // Sync the state with the DOM
    const isLeafElement = el.children.length === 0;

    if (!bindProperties.length && !isLeafElement) return;

    // DOM events -> Alpine.app.state
    reactToEvents(el, propPath);

    // Alpine.app.state -> DOM
    effect(() => {
      const currentValue = get(Alpine.app.state, valuePath);

      if (
        !bindProperties.length &&
        isLeafElement &&
        !el.hasAttribute("x-text") &&
        el.tagName !== "INPUT" &&
        el.tagName !== "TEXTAREA"
      ) {
        el.innerText = currentValue;
      }

      bindProperties.forEach((propName) => {
        el[propName] = currentValue;
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
