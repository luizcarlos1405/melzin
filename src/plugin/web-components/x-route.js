export const xRoute = () => {
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
          this.innerHTML = responseHtml.replaceAll(scriptTag, "");

          if (javascript) {
            const scriptElement = document.createElement("script");
            scriptElement.innerHTML = javascript;
            Alpine.nextTick(() => this.appendChild(scriptElement));
          }
        });
      };

      if (path == location.pathname + ".html") {
        load();
      }

      document.addEventListener("routeChanged", (event) => {
        if (path == location.pathname + ".html") {
          load();
          return;
        }

        this.innerHTML = "";
      });
    }
  }
  customElements.define("x-route", WebComponent);
};
