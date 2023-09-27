class WebComponent extends HTMLElement {
  connectedCallback() {
    const path = this.getAttribute("path");

    fetch(path, {
      headers: {
        "HX-Request": true,
      },
    }).then(async (response) => {
      const responseHtml = await response.text();
      this.innerHTML = responseHtml;
    });
  }
}
customElements.define("x-route", WebComponent);
