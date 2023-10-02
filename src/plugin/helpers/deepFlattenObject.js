export const deepFlattenObject = (obj) => {
  const flattened = {};

  Object.entries(obj).forEach(([key, value]) => {
    if (typeof value === "object" && value !== null) {
      Object.entries(deepFlattenObject(value)).forEach(([k, v]) => {
        flattened[`${key}.${k}`] = v;
      });
    } else {
      flattened[key] = value;
    }
  });

  return flattened;
};
