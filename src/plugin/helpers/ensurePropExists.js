export const ensurePropExists = (objOrArr, path = [], defaultValue = null) => {
  if (objOrArr === undefined) {
    console.error("invalid objOrArray at ensurePropExists function");
    return;
  }

  const [key, ...pathRest] = path;

  if (key === undefined) {
    return objOrArr;
  }

  if (!pathRest.length) {
    objOrArr[key] ??= defaultValue;
    return objOrArr[key];
  }

  if (objOrArr[key] == null) {
    const isNextKeyNumeric = !Number.isNaN(Number(key));

    if (isNextKeyNumeric) {
      objOrArr[key] = [];
      return ensurePropExists(objOrArr[key], pathRest, defaultValue);
    }

    objOrArr[key] = {};
    return ensurePropExists(objOrArr[key], pathRest, defaultValue);
  }

  return ensurePropExists(objOrArr[key], pathRest, defaultValue);
};
