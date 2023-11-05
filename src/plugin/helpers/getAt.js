import get from "lodash/get";

export const getAt = (path = "", defaultValue) => {
  const stateRoot = Alpine.app.state.root;
  if (path === "") return stateRoot;

  return get(stateRoot, path, defaultValue);
};
