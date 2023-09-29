import { getAt } from "../helpers/getAt";
import { setAt } from "../helpers/setAt";
import { getElementDataPath } from "../helpers/getElementDataPath";
import { scanStructure } from "../helpers/scanStructure";

export const exposeDevHelpers = () => {
  window.$getRoot = () => getAt();
  window.$logState = () => console.log(JSON.stringify(getAt(), null, 2));
  window.$getAt = getAt;
  window.$localStorageStateKey = `melzin@${location.pathname}`;
  window.$storeState = () =>
    localStorage.setItem(window.$localStorageStateKey, JSON.stringify(getAt()));
  window.$getStoredState = () =>
    localStorage.getItem(window.$localStorageStateKey);
  window.$loadStoredState = () => {
    const savedState = JSON.parse(
      localStorage.getItem(window.$localStorageStateKey),
    );
    if (savedState) {
      Object.entries(savedState).forEach(([key, value]) => {
        setAt(key, value);
      });
    }
  };
  window.$getElementDataPath = getElementDataPath;
  window.$scanStructure = scanStructure;
};
