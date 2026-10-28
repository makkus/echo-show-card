import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const files = new Map([
  ["/preview/index.html", ["../preview/index.html", "text/html"]],
  ["/preview/preview.js", ["../preview/preview.js", "text/javascript"]],
  ["/echo-show-card.js", ["../echo-show-card.js", "text/javascript"]],
]);

export async function startPreview(port = 0) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
      response.writeHead(302, { Location: "/preview/index.html" }).end();
      return;
    }
    const entry = files.get(path);
    if (!entry) { response.writeHead(404).end("Not found"); return; }
    try {
      response.writeHead(200, { "Content-Type": `${entry[1]}; charset=utf-8`, "Cache-Control": "no-store" });
      response.end(await readFile(new URL(entry[0], import.meta.url)));
    } catch { response.writeHead(500).end("Preview file unavailable"); }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/preview/index.html` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startPreview(Number(process.argv[2] || 8765));
  console.log(`Preview: ${url}`);
}
