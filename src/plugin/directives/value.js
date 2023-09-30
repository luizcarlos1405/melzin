import { joinPath } from "../helpers/joinPath";
import { getElementDataPath } from "../helpers/getElementDataPath";
import { setAt } from "../helpers/setAt";
import { getAt } from "../helpers/getAt";
import { usefullErrorMessages } from "../helpers/usefullErrorMessages";

export const valueDirective = (
  el,
  { expression: stringPaths, modifiers: elementProperties },
  { evaluate, effect, cleanup },
) => {
  const eventListeners = [];
  const valueDeclarations = stringPaths.split(/\s*,\s*/);
  const elementDataPath = getElementDataPath(el);
  const {
    elementProperty: defaultElementProperty,
    eventName,
    getSelector,
    getValueFromEvent, // There's no way to specify a custom getter yet
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
        elementProperty,
      };
    },
  );

  // Sync DOM with state (side effects and mutations)
  syncInputForValueDeclarations.forEach(
    ({ valuePathFromRoot, defaultValue, elementProperty }) => {
      // Store all elements using the value at this path
      Alpine.app.syncedPaths[valuePathFromRoot] = [
        ...(Alpine.app.syncedPaths[valuePathFromRoot] ?? []),
        {
          el,
          valuePathFromRoot,
          getSelector,
          elementProperty,
          defaultValue,
          eventName,
        },
      ];

      // Initialize state value if it doesn't exist
      const currentStateValue = getAt(valuePathFromRoot);
      if (currentStateValue == null) {
        setAt(valuePathFromRoot, defaultValue);
      }

      if (currentStateValue != null && defaultValue) {
        usefullErrorMessages.ignoredDefault({
          valuePathFromRoot,
          currentStateValue,
          defaultValue,
          elementProperty,
        });
      }

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
    const value = el[rules.by];
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
    eventName: "input",
    elementProperty: "innerText",
    getValueFromEvent: (event) => event.target.innerText,
  },
};
