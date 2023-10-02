export const parseJsonWithFallback = (json, fallback) => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};
