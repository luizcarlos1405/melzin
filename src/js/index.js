document.addEventListener("alpine:init", () => {
  // Import html
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

  // Helpers
  const ensureUniqueNamespace = (namespace, namespacesObject) => {
    if (namespacesObject[namespace]) {
      let uniqueNamespace = namespace;
      let number = 1;
      while (namespacesObject[uniqueNamespace]) {
        uniqueNamespace = namespace + number;
        number += 1;
      }
      return uniqueNamespace;
    }
    return namespace;
  };

  const ensurePropExists = (objOrArr, path = [], defaultValue = null) => {
    if (objOrArr === undefined) {
      console.error("invalid objOrArray at ensurePropExists function");
      return;
    }

    const [key, ...pathRest] = path;

    if (key === undefined) {
      return objOrArr;
    }

    if (!pathRest.length) {
      objOrArr[key] ??= defaultValue;
      return objOrArr[key];
    }

    if (objOrArr[key] == null) {
      const isNextKeyNumeric = !Number.isNaN(Number(key));

      if (isNextKeyNumeric) {
        objOrArr[key] = [];
        return ensurePropExists(objOrArr[key], pathRest, defaultValue);
      }

      objOrArr[key] = {};
      return ensurePropExists(objOrArr[key], pathRest, defaultValue);
    }

    return ensurePropExists(objOrArr[key], pathRest, defaultValue);
  };

  const propsStringToObject = (propString) => {
    const props = propString.split(/\s*,\s*/);
    const data = {};
    props.forEach((prop) => {
      const [stringPath, stringValue] = prop.split(/\s*:\s*/);

      if (!stringPath) {
        return;
      }

      const path = stringPath.split(".");
      const value = stringValue
        ? Alpine.evaluate(document.body, stringValue)
        : null;

      ensurePropExists(data, path, value);
    });

    return data;
  };

  const objectToString = (obj) => {
    return (
      "{" +
      Object.entries(obj)
        .map(([key, value]) => {
          if (typeof value === "object" && value !== null) {
            return `${key}: ${objectToString(value)}`;
          }

          if (typeof value === "string") {
            return `${key}: '${value}'`;
          }

          return `${key}: ${value}`;
        })
        .join(", ") +
      "}"
    );
  };

  // Components
  const appComponents = {};
  window.appComponents = appComponents;

  Alpine.directive(
    "prop",
    (
      el,
      { expression: stringPath, modifiers: bindProperties },
      { evaluate, evaluateLater },
    ) => {
      const props = stringPath.split(/\s*,\s*/);
      props.forEach((prop) => {
        const [stringPath, defaultValueExpression] = prop.split(/\s*:\s*/);

        if (!stringPath) {
          return;
        }

        const isLeafElement = el.children.length === 0;

        const defaultValue = defaultValueExpression
          ? evaluate(defaultValueExpression)
          : isLeafElement
          ? el.innerText
          : null;

        const getData = evaluateLater("$data");
        Alpine.effect(() => {
          getData((data) => {
            if (data && data[stringPath] == null) {
              data[stringPath] = defaultValue;
            }

            const value = data[stringPath];

            if (value != null) {
              if (
                !bindProperties.length &&
                isLeafElement &&
                !el.hasAttribute("x-text") &&
                el.tagName !== "INPUT" &&
                el.tagName !== "TEXTAREA"
              ) {
                el.innerText = value;
              }

              bindProperties.forEach((propName) => {
                el[propName] = value;
              });

              return;
            }

            data[stringPath] = defaultValue;
          });
        });
      });
    },
  );

  Alpine.directive("each", (el, { expression }) => {
    el.setAttribute("x-for", `($item, $index) in ${expression}`);
  }).before("for");

  Alpine.directive(
    "component",
    (el, { expression, modifiers, value: scopeName }) => {
      if (el.tagName !== "TEMPLATE") {
        throw new Error("Component must be a template");
      }

      const template = el;
      class WebComponent extends HTMLElement {
        constructor() {
          super();
        }
        connectedCallback() {
          const templateContent = template.content;

          const finalDataObject = {};

          const initialDataString = this.getAttribute("x-data");
          const initialDataObject = initialDataString
            ? Alpine.evaluate(this, initialDataString)
            : {};

          const xPropElements = templateContent.querySelectorAll("[x-prop]");
          xPropElements.forEach((xPropElement) => {
            const xPropValue = xPropElement.getAttribute("x-prop");
            const xPropElementData = propsStringToObject(xPropValue);
            Object.assign(finalDataObject, xPropElementData);
          });

          // This means the component was called with x-for
          // and we need to merge the data from the x-for element
          try {
            const xForElementData = Alpine.evaluate(
              this,
              "(()=>{try{return {...$item, $index}}catch{return null}})()",
            );
            if (xForElementData) {
              Object.assign(finalDataObject, xForElementData);
            }
          } catch {}

          // This means some values were passed to the component
          Object.assign(finalDataObject, initialDataObject);

          const finalDataString = objectToString(finalDataObject);
          this.setAttribute("x-data", finalDataString);

          // Namespace
          const namespace = ensureUniqueNamespace(expression, appComponents);
          const el = this;
          appComponents[namespace] = {
            el,
            getData: () => Alpine.evaluate(el, "$data"),
            namespace,
          };
          this.setAttribute("data-namespace", namespace);

          // Shadow DOM
          const isShadowDom = modifiers.includes("shadowdom");

          if (isShadowDom) {
            const shadowRoot = this.attachShadow({ mode: "open" });
            shadowRoot.appendChild(templateContent.cloneNode(true));
            return this;
          }

          this.appendChild(templateContent.cloneNode(true));
        }
      }

      const componentName = /\b-\b/.test(expression)
        ? expression
        : `c-${expression}`;
      customElements.define(componentName, WebComponent);
    },
  ).before("data");
});
