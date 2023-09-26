export const joinPath = (...paths) =>
  paths.filter((value) => value !== "").join(".");
