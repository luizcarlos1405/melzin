import get from "lodash/get";
import { joinPath } from "../helpers/joinPath";
import set from "lodash/set";
import { getScopeForElement } from "../helpers/getScopeForElement";

export const propDirective = (
  el,
  { expression: stringPaths, modifiers: bindProperties },
  { evaluate, effect },
) => {
  const propDeclarations = stringPaths.split(/\s*,\s*/);
  const scopePath = getScopeForElement(el);
  const domPropPaths = getDomPropPaths(el, bindProperties);
  const eventsWithValueGetters = getEventsWithValueGetters(el);

  // Pure transformations, no side effects or mutations
  const syncInputForPropDeclarations = propDeclarations.map((prop, index) => {
    const [valuePath, defaultValueExpression] = prop.split(/\s*:\s*/);
    const defaultValue = defaultValueExpression
      ? evaluate(defaultValueExpression)
      : null;

    const domPropPath = domPropPaths[index];
    const initialPropertyValue = el[domPropPath] ?? null;
    const { eventName, valueFromEvent } = eventsWithValueGetters[index] || {};

    return {
      stateValuePath: joinPath(scopePath, valuePath),
      defaultValue: defaultValue ?? initialPropertyValue,
      domPropPath,
      eventName,
      valueFromEvent,
    };
  });

  // Sync DOM with state (side effects and mutations)
  syncInputForPropDeclarations.forEach(
    ({
      stateValuePath,
      defaultValue,
      domPropPath,
      eventName,
      valueFromEvent,
    }) => {
      // Initialize state value if it doesn't exist
      const currentStateValue = get(Alpine.app.state, stateValuePath);
      if (currentStateValue === undefined) {
        set(Alpine.app.state, stateValuePath, defaultValue);
      }

      // DOM -> Alpine.app.state
      if (eventName && valueFromEvent) {
        el.addEventListener(eventName, (event) => {
          Alpine.app.state[stateValuePath] = valueFromEvent(event);
        });
      }

      // Alpine.app.state -> DOM
      if (domPropPath) {
        effect(() => {
          const newStateValue = get(Alpine.app.state, stateValuePath);
          set(el, domPropPath, newStateValue);
        });
      }
    },
  );
};

const getEventsWithValueGetters = (el) => {
  const isCheckbox = el.tagName === "INPUT" && el.type === "checkbox";

  if (isCheckbox) {
    return [
      {
        eventName: "change",
        valueFromEvent: (event) => event.target.checked,
      },
    ];
  }

  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    return [
      { eventName: "input", valueFromEvent: (event) => event.target.value },
    ];
  }

  return [];
};

const getDomPropPaths = (el, bindProperties) => {
  const isLeafElement = el.children.length === 0;

  if (
    !bindProperties.length &&
    isLeafElement &&
    !el.hasAttribute("x-text") &&
    el.tagName !== "INPUT" &&
    el.tagName !== "TEXTAREA"
  ) {
    return ["innerText"];
  }

  if (el.tagName === "INPUT") {
    return bindProperties.length ? bindProperties : ["value"];
  }

  return bindProperties;
};
