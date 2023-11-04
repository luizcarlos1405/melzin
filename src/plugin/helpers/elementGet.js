import { getAt } from "./getAt";
import { getElementDataPath } from "./getElementDataPath";
import { joinPath } from "./joinPath";

export const elementGet = (el, path = "") => {
  const pathFromRoot = joinPath(getElementDataPath(el), path);
  return getAt(pathFromRoot);
};
