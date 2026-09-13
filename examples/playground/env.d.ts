// Vite `?raw` imports resolve to the file text.
declare module '*?raw' {
  const text: string;
  export default text;
}
