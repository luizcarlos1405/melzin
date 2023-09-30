export const usefullErrorMessages = {
  ignoredDefault: ({
    valuePathFromRoot,
    currentStateValue,
    defaultValue,
    elementProperty,
  }) =>
    console.warn(
      `While running "x-value" for the element:`,
      el,
      "\n\n",
      `The value at "${valuePathFromRoot}" is already initialized to "${currentStateValue}". This means:`,
      "\n\n",
      `1. The default value "${defaultValue}" will be ignored.`,
      "\n",
      `2. The property "${elementProperty}" will be initialized to "${currentStateValue}".`,
    ),
};
