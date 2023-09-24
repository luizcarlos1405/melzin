class WebComponent extends HTMLElement {
  connectedCallback() {
    const from = this.getAttribute("from");

    if (this._x_alreadyFetched || this.closest("[x-ignore]")) {
      return;
    }

    fetch(from, {
      headers: {
        "HX-Request": true,
      },
    }).then(async (response) => {
      const responseHtml = await response.text();
      this.innerHTML = responseHtml;
      this._x_alreadyFetched = true;
    });
  }
}
customElements.define("x-import", WebComponent);
