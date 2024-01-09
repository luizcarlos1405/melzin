import mapKeys from "lodash/mapKeys";
import { ensureArray } from "../helpers/ensureArray";
import { getAt } from "../helpers/getAt";
import { setAt } from "../helpers/setAt";
import YAML from "yaml";
import hljs from "highlight.js";
import "highlight.js/styles/tokyo-night-dark.min.css";
import yamlHighlightLanguage from "highlight.js/lib/languages/yaml";
import kebabCase from "lodash/kebabCase";

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
    autoSaveState = false;
    setFromDevTools = false;
    rootElement = null;
    toggleButton = null;
    codeElement = null;
    saveState = () => {
      window.$storeState();
    };
    loadState = () => {
      window.$loadStoredState();
    };

    constructor() {
      super();
    }

    toggle() {
      this.open = !this.open;

      this.rootElement.style.right = this.open ? "0" : "-25vw";
      this.toggleButton.innerText = this.open ? this.openText : this.closedText;
    }
    connectedCallback() {
      this.autoSaveState = this.hasAttribute("auto-save");

      setTimeout(() => {
        if (this.autoSaveState) {
          this.loadState();
        }

        this.toggleButton = e("button", {});
        this.toggleButton.style["margin-bottom"] = "1rem";
        this.toggleButton.style["align-self"] = "flex-end";
        this.toggleButton.style.position = "fixed";
        this.toggleButton.style.top = "1em";
        this.toggleButton.style.right = "1em";
        this.toggleButton.style["z-index"] = "999";
        this.toggleButton.innerText = this.open
          ? this.openText
          : this.closedText;

        this.codeElement = e("code", { class: "hljs" });
        this.codeElement.style.display = "block";
        this.codeElement.style["flex-grow"] = "1";
        this.codeElement.style["overflow"] = "scroll";
        this.codeElement.style["white-space"] = "pre-wrap";
        this.codeElement.style["font-size"] = "12px";
        this.codeElement.style.padding = "1rem";
        this.codeElement.style.width = "100%";
        this.codeElement.style.height = "100%";
        this.codeElement.style.border = "1px solid #ddd";
        this.codeElement.style.position = "relative";
        this.codeElement.contentEditable = true;
        this.codeElement.spellcheck = false;

        this.rootElement = e("div", {}, [this.toggleButton, this.codeElement]);
        this.rootElement.style.display = "flex";
        this.rootElement.style["flex-direction"] = "column";
        this.rootElement.style["z-index"] = "999";
        this.rootElement.style.position = "fixed";
        this.rootElement.style.top = "0";
        this.rootElement.style.right = this.open ? "0" : "-25vw";
        this.rootElement.style.width = "25vw";
        this.rootElement.style.height = "100vh";
        this.rootElement.style.padding = "0.5rem";

        this.appendChild(this.rootElement);
        Alpine.devtools = this;

        this.toggleButton.onclick = () => {
          this.toggle();
        };

        Alpine.effect(() => {
          // React to all changes by stringifying the state
          const state = JSON.parse(JSON.stringify(getAt("", null)));
          if (this.autoSaveState) {
            this.saveState();
          }

          if (this.setFromDevTools) {
            this.setFromDevTools = false;
            return;
          }

          const yaml = YAML.stringify(state);
          const highlightedYaml = hljs.highlight(yaml, {
            language: "yaml",
          }).value;
          this.codeElement.innerHTML = highlightedYaml;
        });

        this.codeElement.oninput = (event) => {
          try {
            const state = YAML.parse(event.target.innerText);
            this.setFromDevTools = true;
            setAt("", state);
            this.codeElement.style.border = "1px solid #ddd";
          } catch (error) {
            this.codeElement.style.border = "1px solid red";
          }
        };

        this.codeElement.onblur = () => {
          const yaml = this.codeElement.innerText;
          const highlightedYaml = hljs.highlight(yaml, {
            language: "yaml",
          }).value;
          this.codeElement.innerHTML = highlightedYaml;
        };

        document.addEventListener("keydown", (event) => {
          if (event.ctrlKey && event.altKey && event.key === "k") {
            this.toggle();
          }
        });
      }, 200);
    }
  }
  customElements.define("x-devtools", WebComponent);
};
