import { evaluateWithState } from "../helpers/evaluateWithState";

export const xOnly = () => {
  class WebComponent extends HTMLElement {
    connectedCallback() {
      const if_ = this.getAttribute("if");
      const children = [...this.childNodes].map((child) => {
        return child.cloneNode(true);
      });
      this.innerHTML = "";

      Alpine.effect(() => {
        if (evaluateWithState(this, if_, false)) {
          this.append(...children.map((child) => child.cloneNode(true)));
          return;
        }

        this.innerHTML = "";
      });
    }
  }
  customElements.define("x-only", WebComponent);
};
