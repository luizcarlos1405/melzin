export const joinPath = (path1, path2) =>
  [path1, path2].filter(Boolean).join(".");
