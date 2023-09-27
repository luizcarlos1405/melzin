export const templateString = (rawString = "") => {
  const matches = [...rawString.matchAll(/{\s?([^\s{}]+)\s?}/g)];

  return (data) => {
    const finalString = rawString;

    matches.forEach((match) => {
      const [fullMatch, key] = match;
      const value = data[key] ?? "";
      finalString = finalString.replace(fullMatch, value);
    });

    return finalString;
  };
};
