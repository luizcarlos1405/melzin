export const evaluateWithDefault = (
  el,
  expression,
  defaultValueExpression = "null",
) =>
  Alpine.evaluate(
    el,
    `(()=>{try{return ${expression}}catch{return ${defaultValueExpression}}})()`,
  );
