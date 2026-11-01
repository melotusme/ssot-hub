const http = require("http");
http
  .createServer(async (req, res) => {
    const state = pm.state;
    const path = req.url.split("?")[0];
    const reply = (status, body = "", headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(body);
    };
    if (path === "/reset" && req.method === "POST") {
      await state.set("ssot.files", {});
      await state.set("ssot.fail", false);
      return reply(204);
    }
    if (path === "/fail" && req.method === "POST") {
      await state.set("ssot.fail", true);
      return reply(204);
    }
    if (await state.get("ssot.fail"))
      return reply(503, JSON.stringify({ error: "injected service outage" }));
    if (path !== "/SSOT-Hub" && !path.startsWith("/SSOT-Hub/"))
      return reply(501);
    if (req.method === "MKCOL") return reply(201);
    const files = (await state.get("ssot.files")) || {};
    const value = files[path];
    if (req.method === "GET")
      return value ? reply(200, value.body, { ETag: value.etag }) : reply(404);
    if (req.method === "PUT") {
      if (
        (req.headers["if-none-match"] === "*" && value) ||
        (req.headers["if-match"] && req.headers["if-match"] !== value?.etag)
      )
        return reply(412);
      const body =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      files[path] = {
        body,
        etag: '"' + Date.now() + "-" + Math.random() + '"',
      };
      await state.set("ssot.files", files);
      return reply(value ? 204 : 201);
    }
    reply(501);
  })
  .listen(process.env.PORT);
