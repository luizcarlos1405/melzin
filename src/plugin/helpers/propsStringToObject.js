import { ensurePropExists } from "./ensurePropExists";

export const propsStringToObject = (propString, defaultValue = null) => {
  const props = propString.split(/\s*,\s*/);
  const data = {};

  if (props.length === 0) {
    return defaultValue;
  }

  props.forEach((prop) => {
    const [stringPath, stringValue] = prop.split(/\s*:\s*/);

    if (!stringPath) {
      return;
    }

    const path = stringPath.split(".");
    const value = stringValue
      ? Alpine.evaluate(document.body, stringValue)
      : defaultValue;

    ensurePropExists(data, path, value);
  });

  return data;
};
