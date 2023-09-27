export const eventDirective = (
  el,
  { expression: eventName, modifiers },
  { cleanup },
) => {
  const [originEvent, handlerKey] = eventName.split(/\s*:\s*/);

  const handler = (event) => {
    modifiers.forEach((modifier) => {
      event[modifier]?.();
    });

    const eventFunction = Alpine.app.event[handlerKey];
    if (eventFunction) {
      eventFunction(event);
      return;
    }

    console.info("eventDirective", {
      originEvent,
      eventName: handlerKey,
      event,
    });
  };

  el.addEventListener(originEvent, handler);

  cleanup(() => {
    window.removeEventListener(eventName, handler);
  });
};
