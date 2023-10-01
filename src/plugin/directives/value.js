import { joinPath } from "../helpers/joinPath";
import { getElementDataPath } from "../helpers/getElementDataPath";
import { setAt } from "../helpers/setAt";
import { getAt } from "../helpers/getAt";
import get from "lodash/get";
import { declareValueAt } from "../helpers/declareValueAt";

export const valueDirective = (
  el,
  {
    expression: stringPaths,
    value: syncDirective,
    modifiers: elementProperties,
  },
  { evaluate, effect, cleanup },
) => {
  const eventListeners = [];
  const valueDeclarations = stringPaths.split(/\s*,\s*/);
  const elementDataPath = getElementDataPath(el);
  const {
    elementProperty: defaultElementProperty,
    eventName,
    getSelector,
    getValueFromEvent,
  } = getHowToSyncPropertyWithState(el);

  // Pure transformations, no side effects or mutations
  const syncInputForValueDeclarations = valueDeclarations.map(
    (valueDeclaration, index) => {
      const [valuePath, ...valueExressionRest] =
        valueDeclaration.split(/\s*:\s*/);
      const defaultValueExpression = valueExressionRest.join(":");
      const defaultValue = defaultValueExpression
        ? evaluate(defaultValueExpression)
        : null;

      const elementProperty =
        elementProperties[index] || defaultElementProperty;

      const initialPropertyValue = el[elementProperty] ?? null;

      return {
        valuePathFromRoot: joinPath(elementDataPath, valuePath),
        defaultValue: defaultValue ?? initialPropertyValue,
        valuePath,
        elementProperty,
      };
    },
  );

  // Sync DOM with state (side effects and mutations)
  syncInputForValueDeclarations.forEach(
    ({ valuePathFromRoot, defaultValue, elementProperty, valuePath }) => {
      declareValueAt(valuePathFromRoot, defaultValue, {
        el,
        elementProperty,
        getSelector,
        eventName,
      });

      // app state -> DOM
      if (elementProperty) {
        effect(() => {
          const newStateValue = getAt(valuePathFromRoot);
          el[elementProperty] = newStateValue;
        });
      }

      // DOM -> app state
      if (eventName && getValueFromEvent) {
        const handler = (event) => {
          setAt(valuePathFromRoot, getValueFromEvent(event, el));
        };
        const selector = getSelector ? getSelector(el) : null;
        const elements = selector ? document.querySelectorAll(selector) : [el];
        elements.forEach((element) => {
          element.addEventListener(eventName, handler);
          eventListeners.push({
            el: element,
            name: eventName,
            handler,
          });
        });
      }

      // Sync other directives with the value at this path
      if (syncDirective) {
        el.setAttribute("x-" + syncDirective, `$get('${valuePath}')`);
      }
    },
  );

  cleanup(() =>
    eventListeners.forEach(({ el, name, handler }) => {
      el.removeEventListener(name, handler);
    }),
  );
};

const getHowToSyncPropertyWithState = (
  el,
  rules = syncElementPropertyToStateRules,
) => {
  if (rules.by) {
    const value = get(el, rules.by);
    const newRules = rules[value] ?? rules.default;
    return getHowToSyncPropertyWithState(el, newRules);
  }

  return rules;
};

const syncElementPropertyToStateRules = {
  by: "tagName",
  INPUT: {
    by: "type",
    checkbox: {
      eventName: "change",
      elementProperty: "checked",
      getValueFromEvent: (event) => event.target.checked,
    },
    radio: {
      eventName: "click",
      elementProperty: "checked",
      getSelector: (el) => `[name="${el.name}"]`,
      getValueFromEvent: (_, el) => el.checked,
    },
    default: {
      eventName: "input",
      elementProperty: "value",
      getValueFromEvent: (event) => event.target.value,
    },
  },
  TEXTAREA: {
    eventName: "input",
    elementProperty: "value",
    getValueFromEvent: (event) => event.target.value,
  },
  default: {
    by: "children.length",
    0: {
      eventName: "input",
      elementProperty: "innerText",
      getValueFromEvent: (event) => event.target.innerText,
    },
    default: {},
  },
};
