export const queryWholeHtml = (selector, rootElement = document.body) => {
  const templates = Array.from(rootElement.querySelectorAll("template"));
  const fromInsideTemplates = templates.flatMap((template) =>
    queryWholeHtml(selector, template.content),
  );

  return [
    ...Array.from(rootElement.querySelectorAll(selector)),
    ...fromInsideTemplates,
  ];
};
