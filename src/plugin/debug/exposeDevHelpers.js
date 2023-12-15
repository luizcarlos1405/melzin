import { getAt } from "../helpers/getAt";
import { setAt } from "../helpers/setAt";
import { getElementDataPath } from "../helpers/getElementDataPath";
import { scanStructure } from "../helpers/scanStructure";
import { queryWholeHtml } from "../helpers/queryWholeHtml";
import { parseJsonWithFallback } from "../helpers/parseJsonWithFallback";

export const exposeDevHelpers = () => {
  window.$logState = () => console.log(JSON.stringify(getAt(), null, 2));
  window.$getLocalStorageStateKey = () => `melzin@${location.pathname}`;
  window.$storeState = () =>
    localStorage.setItem(
      window.$getLocalStorageStateKey(),
      JSON.stringify(getAt()),
    );
  window.$getStoredState = () =>
    localStorage.getItem(window.$getLocalStorageStateKey());
  window.$loadStoredState = () => {
    const savedState = parseJsonWithFallback(
      localStorage.getItem(window.$getLocalStorageStateKey()),
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
