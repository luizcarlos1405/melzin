class WebComponent extends HTMLElement {
  connectedCallback() {
    const path = this.getAttribute("path") || location.pathname;

    fetch(path, {
      headers: {
        "HX-Request": true,
      },
    }).then(async (response) => {
      const responseHtml = await response.text();
      const [scriptTag, javascript] =
        /^\s*<script>([^<]*)<\/script>[\s|\n]*/.exec(responseHtml) || [];
      this.innerHTML = responseHtml.replaceAll(scriptTag, "");

      const scriptElement = document.createElement("script");
      scriptElement.innerHTML = javascript;

      Alpine.nextTick(() => this.appendChild(scriptElement));
    });
  }
}
customElements.define("x-route", WebComponent);
