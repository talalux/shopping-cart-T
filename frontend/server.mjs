// Custom server whose only job is to make the client IP trustworthy.
// Next.js does `req.headers['x-forwarded-for'] ??= socket.remoteAddress`, i.e. a client-supplied header survives.
// Here we OVERWRITE it with the socket address before Next sees the request, so the BFF proxy can forward a real IP
// to the .NET rate limiter. If a reverse proxy is ever placed in front of Next, replace the socket address below
// with the value that proxy sets (and only trust it when the request really comes from that proxy).
import { createServer } from "node:http";

const prod = process.argv.includes("--prod");
process.env.NODE_ENV = prod ? "production" : "development";
const { default: next } = await import("next");

const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev: !prod, hostname: "localhost", port });
const handle = app.getRequestHandler();
await app.prepare();

const clean = (ip) => (ip ?? "").replace(/^::ffff:/, "");

createServer((req, res) => {
  req.headers["x-forwarded-for"] = clean(req.socket.remoteAddress);
  delete req.headers["x-real-ip"];
  handle(req, res);
  
}).listen(port, () => {
  console.log(`> Ready on http://localhost:${port} (${prod ? "production" : "development"})`);
});
