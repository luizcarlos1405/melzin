import { getElementDataPath } from "../helpers/getElementDataPath";

export const scopeMagic = (el) => {
  return getElementDataPath(el);
};
