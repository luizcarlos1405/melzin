import { getAt } from "../helpers/getAt";
import { setAt } from "../helpers/setAt";
import { getElementDataPath } from "../helpers/getElementDataPath";
import { scanStructure } from "../helpers/scanStructure";
import { queryWholeHtml } from "../helpers/queryWholeHtml";
import { parseJsonWithFallback } from "../helpers/parseJsonWithFallback";

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
    const savedState = parseJsonWithFallback(
      localStorage.getItem(window.$localStorageStateKey),
      {},
    );
    if (savedState) {
      // Alpine.app.state.root = savedState;
      Object.entries(savedState).forEach(([key, value]) => {
        setAt(key, value);
      });
    }
  };
  window.$togglePersistState = () => {
    const newPersistState =
      localStorage.getItem("melzin@persistState") === "true" ? "false" : "true";
    localStorage.setItem("melzin@persistState", newPersistState);
  };
  window.$getElementDataPath = getElementDataPath;
  window.$scanStructure = scanStructure;
  window.$logStructure = () =>
    console.log(JSON.stringify(scanStructure(), null, 2));

  window.$queryWholeHtml = queryWholeHtml;
};
