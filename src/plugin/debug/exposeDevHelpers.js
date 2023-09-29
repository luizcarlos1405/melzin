import { getAt } from "../helpers/getAt";
import { setAt } from "../helpers/setAt";
import { getElementDataPath } from "../helpers/getElementDataPath";
import { scanStructure } from "../helpers/scanStructure";

export const exposeDevHelpers = () => {
  window.$getAt = getAt;
  window.$setAt = setAt;
  window.$getRoot = () => getAt();
  window.$setRoot = (value) => setAt("", value);
  window.$state = Alpine.app.state;
  window.$logState = () => console.log(JSON.stringify(getAt(), null, 2));
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
