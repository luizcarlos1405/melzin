import { getAt } from "./getAt";
import { setAt } from "./setAt";
import { usefullErrorMessages } from "./usefullErrorMessages";

// Initialize state value if it doesn't exist.
// This basically declares that the value exists in the state
// at the given path, and sets it to the default value if it
// doesn't exist yet.
export const declareValueAt = (
  valuePathFromRoot,
  defaultValue = null,
  meta = {},
) => {
  // Store all elements using the value at this path
  Alpine.app.syncedPaths[valuePathFromRoot] = [
    ...(Alpine.app.syncedPaths[valuePathFromRoot] ?? []),
    {
      valuePathFromRoot,
      defaultValue,
      ...meta,
    },
  ];

  const currentStateValue = getAt(valuePathFromRoot);
  if (currentStateValue === undefined) {
    setAt(valuePathFromRoot, defaultValue);
  }

  if (
    currentStateValue !== undefined &&
    defaultValue &&
    !Alpine.app.syncedPaths[valuePathFromRoot]
  ) {
    usefullErrorMessages.ignoredDefault({
      el: meta.el || "Declared without an element",
      elementProperty: meta.elementProperty,
      valuePathFromRoot,
      currentStateValue,
      defaultValue,
    });
  }

  return currentStateValue ?? defaultValue;
};
