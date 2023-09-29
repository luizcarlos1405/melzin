import { getElementDataPath } from "../helpers/getScopeForElement";

export const scopeMagic = (el) => {
  return getElementDataPath(el);
};
