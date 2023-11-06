export const isNumeric = (value) => {
  return (
    typeof value === "number" ||
    (typeof value === "string" && value !== "" && !Number.isNaN(Number(value)))
  );
};
