class WebComponent extends HTMLElement {
  connectedCallback() {
    const path = this.getAttribute("path");

    window._registeredRoutes = window._registeredRoutes || {};
    if (window._registeredRoutes[path]) {
      return;
    }
    window._registeredRoutes[path] = { el: this };

    const load = async () => {
      fetch(path, {
        headers: {
          "HX-Request": true,
        },
      }).then(async (response) => {
        const responseHtml = await response.text();
        const [scriptTag, javascript] =
          /^\s*<script>([^<]*)<\/script>[\s|\n]*/.exec(responseHtml) || [];

        if (javascript) {
          this.innerHTML = responseHtml.replaceAll(scriptTag, "");

          const scriptElement = document.createElement("script");
          scriptElement.innerHTML = javascript;
          Alpine.nextTick(() => this.appendChild(scriptElement));
        }
      });
    };

    if (path.startsWith(location.pathname)) {
      load();
    }

    document.addEventListener("routeChanged", (event) => {
      if (path.startsWith(location.pathname)) {
        load();
        return;
      }

      this.innerHTML = "";
    });
  }
}
customElements.define("x-route", WebComponent);
