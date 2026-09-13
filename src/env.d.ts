// Vite `?inline` CSS imports resolve to the stylesheet text.
declare module '*.css?inline' {
  const css: string;
  export default css;
}
