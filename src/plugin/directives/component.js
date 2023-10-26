import { isCreatedByEachDirective } from "../helpers/isCreatedByEachDirective";
import { objectToString } from "../helpers/objectToString";
import { propsStringToObject } from "../helpers/propsStringToObject";

export const componentDirective = (
  el,
  { expression, modifiers },
  { Alpine },
) => {
  if (el.tagName !== "TEMPLATE") {
    throw new Error("Component must be a template");
  }

  const template = el;
  const name = /\b-\b/.test(expression) ? expression : `c-${expression}`;
  const tagName = name.toUpperCase();

  const isRegisteredAlready = Alpine.components[tagName];
  if (isRegisteredAlready) {
    return;
  }

  const componentInfo = {
    template,
    name: name,
    tagName,
  };

  class WebComponent extends HTMLElement {
    constructor() {
      super();
      this._x_component = componentInfo;
    }
    connectedCallback() {
      // TODO this ignores any <teplate> tags inside the component
      // maybe we should deal with that?
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
      // if (isCreatedByEachDirective(this)) {
      //   Object.assign(finalDataObject, isEachItem);
      // }

      // This means some values were passed to the component
      Object.assign(finalDataObject, initialDataObject);

      const finalDataString = objectToString(finalDataObject);
      this.setAttribute("x-data", finalDataString);

      // Shadow DOM
      const isShadowDom = modifiers.includes("shadowdom");

      if (isShadowDom) {
        const shadowRoot = this.attachShadow({ mode: "open" });
        shadowRoot.appendChild(templateContent.cloneNode(true));
        return this;
      }

      // <slot> without shadow dom
      const slotNodes = templateContent.querySelectorAll("slot");
      slotNodes.forEach((slotNode) => {
        const slotName = slotNode.getAttribute("name");
        for (const child of this.children) {
          if (child.getAttribute("slot") === slotName) {
            slotNode.replaceWith(child);
          }
        }
      });

      this.replaceChildren(templateContent.cloneNode(true));
    }
  }

  customElements.define(name, WebComponent);
  Alpine.components[componentInfo.tagName] = componentInfo;
};
