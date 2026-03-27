import { renderPackageDocs } from "../src/agent-docs/render";

const projectRoot = import.meta.dir + "/..";
renderPackageDocs(projectRoot);
console.log("Generated package-level agent docs");
