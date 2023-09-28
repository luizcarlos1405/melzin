import get from "lodash/get";

export const exposeDevHelpers = (Alpine) => {
  window.$state = Alpine.app.state;
  window.$logState = () => console.log(JSON.stringify(Alpine.app.state, null, 2));
  window.$get = (path) => get(Alpine.app.state, path);
  window.$localStorageStateKey = `melzin@${location.pathname}`;
  window.$storeState = () =>
    localStorage.setItem(
      window.$localStorageStateKey,
      JSON.stringify(Alpine.app.state),
    );
  window.$getStoredState = () => localStorage.getItem(window.$localStorageStateKey);
  window.$loadStoredState = () => {
    const savedState = JSON.parse(
      localStorage.getItem(window.$localStorageStateKey),
    );
    if (savedState) {
      Object.entries(savedState).forEach(([key, value]) => {
        Alpine.app.state[key] = value;
      });
    }
  };

  window.$loadStoredState();
};
