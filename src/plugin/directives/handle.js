import { elementGet } from "../helpers/elementGet";
import { evaluateWithFallback } from "../helpers/evaluateWithFallback";

export const handleDirective = (
  el,
  { expression: handleDeclaration, value: eventName },
  { cleanup },
) => {
  const [handlerName, ...eventMethods] = handleDeclaration.split(/\s*\.\s*/);

  const handlerWrapper = (event) => {
    eventMethods.forEach((eventMethod) => {
      event[eventMethod]?.();
    });

    const handler = Alpine.app.handlers[handlerName];
    if (handler) {
      handler(event, elementGet(el), {
        $index: evaluateWithFallback(el, "$index", null),
      });
      return;
    }

    if (eventName === "submit") {
      const formData = new FormData(el);
      const data = Object.fromEntries(formData.entries());
      console.info(
        `Event "submit" called handler "${handlerName}". Data:`,
        data,
      );
      return;
    }

    console.info(`Event "${eventName}" called handler "${handlerName}".`);
  };

  el.addEventListener(eventName, handlerWrapper);

  cleanup(() => {
    window.removeEventListener(eventName, handlerWrapper);
  });
};
