export const xTest = () => {
  class WebComponent extends HTMLElement {
    connectedCallback() {
      const children = [...this.childNodes].map((child) => {
        return child.cloneNode(true);
      });
      this.innerHTML = "";

      console.log(`children`, children);
    }
  }
  customElements.define("x-test", WebComponent);
};
