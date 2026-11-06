import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", "docs"], {
  stdio: "inherit",
  env: { ...process.env, VITE_BASE_PATH: "/image-splitter/" },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
