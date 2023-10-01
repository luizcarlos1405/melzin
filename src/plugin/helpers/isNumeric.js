export const isNumeric = (value) => {
  return (
    typeof value === "number" ||
    (typeof value === "string" && !Number.isNaN(Number(value)))
  );
};
