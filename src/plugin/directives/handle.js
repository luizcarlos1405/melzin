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
      handler(event);
      return;
    }

    console.info(`Event "${eventName}" called handler "${handlerName}".`);
  };

  el.addEventListener(eventName, handlerWrapper);

  cleanup(() => {
    window.removeEventListener(eventName, handlerWrapper);
  });
};
