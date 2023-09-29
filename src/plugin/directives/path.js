import { getElementDataPath } from "../helpers/getElementDataPath";
import { joinPath } from "../helpers/joinPath";

export const pathDirective = (el, { expression: stringPath }) => {
  const currentDataPath = getElementDataPath(el);
  const elementDataPath = joinPath(currentDataPath, stringPath);

  el.setAttribute("data-path", `${elementDataPath}`);
};
