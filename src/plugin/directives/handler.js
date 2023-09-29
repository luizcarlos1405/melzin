export const handlerDirective = (
  el,
  { expression: handlerDeclaration, value: eventName },
  { cleanup },
) => {
  const [handlerName, ...eventMethods] = handlerDeclaration.split(/\s*\.\s*/);

  const handlerWrapper = (event) => {
    eventMethods.forEach((eventMethod) => {
      event[eventMethod]?.();
    });

    const handler = Alpine.app.handlers[handlerName];
    if (handler) {
      handler(event);
      return;
    }
  };

  el.addEventListener(eventName, handlerWrapper);

  cleanup(() => {
    window.removeEventListener(eventName, handlerWrapper);
  });
};
