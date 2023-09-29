import { joinPath } from "../helpers/joinPath";
import set from "lodash/set";
import { getElementDataPath } from "../helpers/getElementDataPath";
import { setAt } from "../helpers/setAt";
import { getAt } from "../helpers/getAt";

export const syncDirective = (
  el,
  { expression: stringPaths, modifiers: elementProperties },
  { evaluate, effect, cleanup },
) => {
  const eventListeners = [];
  const syncDeclarations = stringPaths.split(/\s*,\s*/);
  const elementDataPath = getElementDataPath(el);
  const elementSyncProperties = getElementSyncProperties(el, elementProperties);
  const eventsWithValueGetters = getEventsWithValueGetters(el);

  // Pure transformations, no side effects or mutations
  const syncInputForSyncDeclarations = syncDeclarations.map((sync, index) => {
    const [valuePath, defaultValueExpression] = sync.split(/\s*:\s*/);
    const defaultValue = defaultValueExpression
      ? evaluate(defaultValueExpression)
      : null;

    const domSyncPath = elementSyncProperties[index];
    const initialPropertyValue = el[domSyncPath] ?? null;
    const { eventName, valueFromEvent } = eventsWithValueGetters[index] || {};

    return {
      valuePathFromRoot: joinPath(elementDataPath, valuePath),
      defaultValue: defaultValue ?? initialPropertyValue,
      domSyncPath,
      eventName,
      valueFromEvent,
    };
  });

  // Sync DOM with state (side effects and mutations)
  syncInputForSyncDeclarations.forEach(
    ({
      valuePathFromRoot,
      defaultValue,
      domSyncPath,
      eventName,
      valueFromEvent,
    }) => {
      // Store all elements using this path
      Alpine.app.syncedPaths[valuePathFromRoot] = [
        ...(Alpine.app.syncedPaths[valuePathFromRoot] ?? []),
        {
          valuePathFromRoot,
          el,
          domSyncPath,
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
        console.warn(
          `While running "x-sync" for the element:`,
          el,
          "\n\n",
          `The value at "${valuePathFromRoot}" is already initialized to "${currentStateValue}". This means:`,
          "\n\n",
          `1. The default value "${defaultValue}" will be ignored.`,
          "\n",
          `2. The property "${domSyncPath}" will be initialized to "${currentStateValue}".`,
        );
      }

      // DOM -> app state
      if (eventName && valueFromEvent) {
        const handler = (event) => {
          setAt(valuePathFromRoot, valueFromEvent(event));
        };
        el.addEventListener(eventName, handler);
        eventListeners.push({
          el,
          name: eventName,
          handler,
        });
      }

      // app state -> DOM
      if (domSyncPath) {
        effect(() => {
          const newStateValue = getAt(valuePathFromRoot);
          set(el, domSyncPath, newStateValue);
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

const getElementSyncProperties = (el, bindProperties) => {
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
