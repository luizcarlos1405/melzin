export const objectToString = (obj) => {
  return (
    "{" +
    Object.entries(obj)
      .map(([key, value]) => {
        if (typeof value === "object" && value !== null) {
          return `${key}: ${objectToString(value)}`;
        }

        if (typeof value === "string") {
          return `${key}: '${value}'`;
        }

        return `${key}: ${value}`;
      })
      .join(", ") +
    "}"
  );
};
