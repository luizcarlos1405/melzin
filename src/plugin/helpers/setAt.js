import set from "lodash/set";

export const setAt = (path = "", value = null) => {
  if (path === "") {
    Alpine.app.state.root = value;
    return;
  }

  const stateRoot = Alpine.app.state.root;

  if (typeof stateRoot !== "object" || stateRoot === null) {
    const isNumericValue = !isNaN(Number(value));
    Alpine.app.state.root = isNumericValue ? [] : {};
  }

  return set(Alpine.app.state.root, path, value);
};
