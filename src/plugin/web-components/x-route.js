export const xRoute = () => {
  class WebComponent extends HTMLElement {
    connectedCallback() {
      const path = this.getAttribute("path");
      const url = this.getAttribute("url") || path;
      const method = this.getAttribute("method") || "GET";

      window._registeredRoutes = window._registeredRoutes || {};
      if (window._registeredRoutes[path]) {
        return;
      }
      window._registeredRoutes[path] = { el: this };

      const load = async () => {
        fetch(url, {
          method,
          headers: {
            "HX-Request": true,
          },
        }).then(async (response) => {
          const responseHtml = await response.text();
          const [scriptTag, javascript] =
            /^\s*<script>([^<]*)<\/script>[\s|\n]*/.exec(responseHtml) || [];
          this.innerHTML = responseHtml.replaceAll(scriptTag, "");

          if (javascript) {
            const scriptElement = document.createElement("script");
            scriptElement.innerHTML = javascript;
            Alpine.nextTick(() => this.appendChild(scriptElement));
          }
        });
      };

      if (path == location.pathname) {
        load();
      }

      document.addEventListener("routeChanged", () => {
        if (path == location.pathname) {
          load();
          return;
        }

        this.innerHTML = "";
      });
    }
  }
  customElements.define("x-route", WebComponent);
};
