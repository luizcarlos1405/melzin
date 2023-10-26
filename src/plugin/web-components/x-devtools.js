import get from "lodash/get";
import { deepFlattenObject } from "../helpers/deepFlattenObject";
import { ensureArray } from "../helpers/ensureArray";
import { getAt } from "../helpers/getAt";
import { scanStructure } from "../helpers/scanStructure";
import { setAt } from "../helpers/setAt";

const e = (
  tag,
  children = [],
  { ["class"]: className, ...properties } = {},
) => {
  const element = document.createElement(tag);
  if (className) {
    element.setAttribute("class", className);
  }
  Object.entries(properties).forEach(([key, value]) => {
    element[key] = value;
  });
  ensureArray(children).forEach((child) =>
    typeof child === "string"
      ? element.appendChild(document.createTextNode(child))
      : element.appendChild(child),
  );
  return element;
};

const inputInfo = (value) => {
  if (typeof value === "boolean") {
    return {
      type: "checkbox",
      property: "checked",
      getValue: (event) => event.target.checked,
      labelClass: "checkbox-input-label",
    };
  }

  return {
    type: "text",
    property: "value",
    getValue: (event) => event.target.value,
    labelClass: "text-input-label",
  };
};

const css = (strings) => strings.join("");

export const xDevtools = () => {
  class WebComponent extends HTMLElement {
    paths = [];
    setFromDevTools = false;
    saveState = () => {
      window.$storeState();
    };
    loadState = () => {
      window.$loadStoredState();
    };

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      setTimeout(() => {
        this.loadState();

        Alpine.effect(() => {
          // React to all changes by stringifying the state
          const state = JSON.parse(JSON.stringify(Alpine.app.state, null, 2));
          this.saveState();

          const structure = scanStructure();
          const newPaths = Array.from(
            new Set(
              [
                ...Object.keys(deepFlattenObject(structure)),
                ...Object.keys(deepFlattenObject(state)),
              ].sort(),
            ),
          );

          if (this.setFromDevTools) {
            this.setFromDevTools = false;
            return;
          }

          this.shadowRoot.innerHTML = "";
          this.paths = newPaths;

          const children = [
            e(
              "style",
              css`
                form {
                  display: flex;
                  flex-wrap: wrap;
                  gap: 1rem;
                }

                .text-input-label {
                  display: flex;
                  flex-direction: column;
                }

                .checkbox-input-label {
                  display: flex;
                  align-items: center;
                }
              `,
            ),
            e(
              "form",
              [
                ...this.paths.flatMap((path, index) => {
                  const pathFromRoot = path.replace(/^root\./, "");
                  const value = getAt(pathFromRoot);

                  const { type, property, getValue, labelClass } =
                    inputInfo(value);
                  const input = e("input", [], {
                    type,
                    [property]: value,
                    oninput: (event) => {
                      const newValue = getValue(event);

                      if (newValue !== undefined) {
                        this.setFromDevTools = true;
                        setAt(pathFromRoot, newValue);
                      }
                    },
                  });

                  const element = e("label", [e("span", pathFromRoot), input], {
                    class: labelClass,
                  });

                  const parentPath = pathFromRoot
                    .split(".")
                    .slice(0, -1)
                    .join(".");
                  const parentValue = get(structure.root, parentPath);

                  if (parentValue?.length != null) {
                    return [
                      element,
                      e(
                        "button",
                        "Add",
                        {
                          type: "button",
                          onclick: () => {
                            const parentStateValue = getAt(parentPath);
                            setAt(parentPath, [...parentStateValue, null]);
                          },
                        },
                        { class: "button" },
                      ),
                    ];
                  }

                  return element;
                }),
              ],
              {
                onsubmit: (event) => {
                  event.preventDefault();
                  console.info(`event`, event);
                },
              },
            ),
          ];

          this.shadowRoot.appendChild(e("div", children));
        });
      }, 200);
    }
  }
  customElements.define("x-devtools", WebComponent);
};
