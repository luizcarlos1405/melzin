import { evaluateWithDefault } from "../helpers/evaluateWithDefault";

export const xOnly = () => {
  class WebComponent extends HTMLElement {
    connectedCallback() {
      const _if = this.getAttribute("if");
      const children = [...this.childNodes].map((child) => {
        return child.cloneNode(true);
      });
      this.innerHTML = "";

      Alpine.effect(() => {
        if (evaluateWithDefault(this, _if, false)) {
          this.append(...children.map((child) => child.cloneNode(true)));
          return;
        }

        this.innerHTML = "";
      });
    }
  }
  customElements.define("x-only", WebComponent);
};
