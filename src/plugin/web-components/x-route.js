export const xRoute = () => {
  class WebComponent extends HTMLElement {
    path = "";
    url = "";
    method = "GET";
    content = null;
    preload = false;
    javascript = "";

    async render() {
      if (!this.content) {
        await this.fetchContent();
      }

      this.style.display = "block";
      this.innerHTML = this.content;

      if (this.javascript) {
        const scriptElement = document.createElement("script");
        scriptElement.innerHTML = this.javascript;
        Alpine.nextTick(() => this.appendChild(scriptElement));
      }
    }

    destroy() {
      this.style.display = "none";
      this.innerHTML = "";
    }

    async fetchContent() {
      return (
        this.content ||
        fetch(this.url, {
          method: this.method,
          headers: {
            "HX-Request": true,
          },
        }).then(async (response) => {
          const responseHtml = await response.text();
          const [scriptTag, javascript] =
            /^\s*<script>([^<]*)<\/script>[\s|\n]*/.exec(responseHtml) || [];
          this.content = responseHtml.replaceAll(scriptTag, "");
          this.javascript = javascript;
        })
      );
    }

    async connectedCallback() {
      this.path = this.getAttribute("path");
      this.url = this.getAttribute("url") || this.path;
      this.method = this.getAttribute("method") || "GET";
      this.preload = this.hasAttribute("preload");

      this.style.display = "none";
      this.style.width = "100%";
      this.style.height = "100%";

      window._registeredRoutes = window._registeredRoutes || {};
      if (window._registeredRoutes[this.path]) {
        return;
      }
      window._registeredRoutes[this.path] = { el: this };

      if (this.preload) {
        await this.fetchContent();
      }

      if (this.path == location.pathname) {
        await this.render();
      }

      document.addEventListener("routeChanged", async () => {
        if (this.path == location.pathname) {
          await this.render();
          return;
        }

        this.destroy();
      });
    }
  }
  customElements.define("x-route", WebComponent);
};
