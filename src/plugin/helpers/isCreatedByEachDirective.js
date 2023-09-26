export const isCreatedByEachDirective = (el) => {
  return !!(el.dataset.isEachItem || el.closest("[data-is-each-item]"));
};
