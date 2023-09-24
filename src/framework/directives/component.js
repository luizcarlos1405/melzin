import { objectToString } from "../helpers/objectToString";
import { propsStringToObject } from "../helpers/propsStringToObject";

export const componentDirective = (
  el,
  { expression, modifiers, value: scopeName },
  { Alpine },
) => {
  if (el.tagName !== "TEMPLATE") {
    throw new Error("Component must be a template");
  }

  const ensureUniqueScope = (scope, scopesObject) => {
    if (scopesObject[scope]) {
      let uniqueScope = scope;
      let number = 1;
      while (scopesObject[uniqueScope]) {
        uniqueScope = scope + number;
        number += 1;
      }
      return uniqueScope;
    }
    return scope;
  };

  const template = el;
  const componentName = /\b-\b/.test(expression)
    ? expression
    : `c-${expression}`;
  const componentInfo = {
    template,
    scopeName,
    name: componentName,
    tagName: componentName.toUpperCase(),
  };
  class WebComponent extends HTMLElement {
    constructor() {
      super();
      this._x_component = componentInfo;
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
          "(()=>{try{return {...$item,$item,$index}}catch{return null}})()",
        );
        if (xForElementData) {
          Object.assign(finalDataObject, xForElementData);
        }
      } catch {}

      // This means some values were passed to the component
      Object.assign(finalDataObject, initialDataObject);

      const finalDataString = objectToString(finalDataObject);
      this.setAttribute("x-data", finalDataString);

      // Scope
      const scope =
        this.dataset.scope || ensureUniqueScope(expression, window.appData);
      const el = this;
      window.appData[scope] = {
        el,
        getData: () => Alpine.evaluate(el, "$data"),
        scope,
      };
      this.setAttribute("data-scope", scope);

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

  customElements.define(componentName, WebComponent);
  Alpine.components[componentInfo.tagName] = componentInfo;
};
