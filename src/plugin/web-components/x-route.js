class WebComponent extends HTMLElement {
  connectedCallback() {
    const path = this.getAttribute("path");

    const load = async () => {
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
    };

    if (location.pathname === path) {
      load();
    }

    document.addEventListener("routeChanged", (event) => {
      if (event.detail.path === path) {
        load();
        return;
      }

      this.innerHTML = "";
    });
  }
}
customElements.define("x-route", WebComponent);
