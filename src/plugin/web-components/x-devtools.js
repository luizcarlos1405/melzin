import get from "lodash/get";
import mapKeys from "lodash/mapKeys";
import { deepFlattenObject } from "../helpers/deepFlattenObject";
import { ensureArray } from "../helpers/ensureArray";
import { getAt } from "../helpers/getAt";
import { scanStructure } from "../helpers/scanStructure";
import { setAt } from "../helpers/setAt";
import YAML from "yaml";
import hljs from "highlight.js";
import "highlight.js/styles/a11y-light.min.css";
import yamlHighlightLanguage from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("yaml", yamlHighlightLanguage);

const e = (tag, attributes = {}, children = []) => {
  const kebabCaseAttributes = mapKeys(attributes, (value, key) =>
    kebabCase(key),
  );
  const element = document.createElement(tag);
  Object.entries(kebabCaseAttributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  ensureArray(children).forEach((child) =>
    typeof child === "string"
      ? element.appendChild(document.createTextNode(child))
      : element.appendChild(child),
  );
  return element;
};

export const xDevtools = () => {
  class WebComponent extends HTMLElement {
    paths = [];
    open = false;
    openText = "▶️";
    closedText = "◀️";
    setFromDevTools = false;
    saveState = () => {
      window.$storeState();
    };
    loadState = () => {
      window.$loadStoredState();
    };

    constructor() {
      super();
    }
    connectedCallback() {
      setTimeout(() => {
        this.loadState();

        this.style.display = "flex";
        this.style["flex-direction"] = "column";
        this.style["z-index"] = "999";
        this.style.position = "fixed";
        this.style.top = "0";
        this.style.right = "0";
        this.style.width = "25vw";
        this.style.height = "100vh";
        this.style.padding = "0.5rem";

        const toggleButton = e("button", {});
        toggleButton.style["margin-bottom"] = "1rem";
        toggleButton.style["align-self"] = "flex-end";
        toggleButton.innerText = this.open ? this.openText : this.closedText;

        const codeElement = e("code");
        codeElement.style.display = "none";
        codeElement.style["flex-grow"] = "1";
        codeElement.style["overflow"] = "scroll";
        codeElement.style["white-space"] = "pre-wrap";
        codeElement.style["font-size"] = "0.8rem";
        codeElement.style.padding = "1rem";
        codeElement.style.width = "100%";
        codeElement.style.height = "100%";
        codeElement.style.background = "#fff";
        codeElement.style.border = "1px solid #ddd";

        codeElement.contentEditable = true;
        codeElement.spellcheck = false;

        this.appendChild(toggleButton);
        this.appendChild(codeElement);

        toggleButton.onclick = () => {
          this.open = !this.open;
          codeElement.style.display = this.open ? "block" : "none";
          toggleButton.innerText = this.open ? this.openText : this.closedText;
        };

        Alpine.effect(() => {
          // React to all changes by stringifying the state
          const state = JSON.parse(JSON.stringify(getAt(), null, 2));
          this.saveState();

          if (this.setFromDevTools) {
            this.setFromDevTools = false;
            return;
          }

          const yaml = YAML.stringify(state);
          const highlightedYaml = hljs.highlight(yaml, {
            language: "yaml",
          }).value;
          codeElement.innerHTML = highlightedYaml;
        });

        codeElement.oninput = (event) => {
          try {
            const state = YAML.parse(event.target.innerText);
            this.setFromDevTools = true;
            setAt("", state);
          } catch (error) {
            console.error(error);
          }
        };

        codeElement.onblur = () => {
          const yaml = codeElement.innerText;
          const highlightedYaml = hljs.highlight(yaml, {
            language: "yaml",
          }).value;
          codeElement.innerHTML = highlightedYaml;
        };
      }, 200);
    }
  }
  customElements.define("x-devtools", WebComponent);
};
