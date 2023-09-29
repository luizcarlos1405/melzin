import set from "lodash/set";

export const setAt = (path = "", value = null) => {
  if (path === "") {
    Alpine.app.state.root = value;
  }

  return set(Alpine.app.state.root, path, value);
};
