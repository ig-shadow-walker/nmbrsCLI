/** Text files bundled into the binary with `import x from "./file.md" with { type: "text" }`. */
declare module "*.md" {
  const content: string;
  export default content;
}
