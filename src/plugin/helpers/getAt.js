import get from "lodash/get";

export const getAt = (path = "", defaultValue) => {
  const stateRoot = Alpine.app.state.root;
  if (path === "") return stateRoot === undefined ? defaultValue : stateRoot;

  return get(stateRoot, path, defaultValue);
};
