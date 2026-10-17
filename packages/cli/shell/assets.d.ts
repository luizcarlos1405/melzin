// Bun's bundler turns an imported SVG into the URL it serves the file at.
declare module '*.svg' {
  const url: string
  export default url
}
