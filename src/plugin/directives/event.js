export const eventDirective = (
  el,
  { expression: handlerDeclaration, value: eventName },
  { cleanup },
) => {
  const [handlerKey, ...eventMethods] = handlerDeclaration.split(/\s*\.\s*/);

  const handler = (event) => {
    eventMethods.forEach((eventMethod) => {
      event[eventMethod]?.();
    });

    const eventFunction = Alpine.app.event[handlerKey];
    if (eventFunction) {
      eventFunction(event);
      return;
    }

    console.info("eventDirective", {
      originEvent: handlerKey,
      eventName,
      event,
    });
  };

  el.addEventListener(eventName, handler);

  cleanup(() => {
    window.removeEventListener(eventName, handler);
  });
};
