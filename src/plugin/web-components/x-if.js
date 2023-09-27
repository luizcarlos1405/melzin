import { evaluateWithDefault } from "../helpers/evaluateWithDefault";

class WebComponent extends HTMLElement {
  connectedCallback() {
    const then = this.getAttribute("then");

    evaluateWithDefault(this, then);
  }
}
customElements.define("x-if", WebComponent);
