// Local stand-in for the Upstash Redis REST API, so the shop runs on your
// computer with no accounts. Data is saved to dev/.data/redis.json.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

export function startMockRedis({ port = 8079, file = path.resolve("dev/.data/redis.json"), token = "dev-token" } = {}) {
  let store = {};
  const expiries = {};
  try {
    store = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* fresh store */
  }
  let saveTimer = null;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(store));
    }, 100);
  };
  const alive = (k) => {
    if (expiries[k] && expiries[k] < Date.now()) {
      delete store[k];
      delete expiries[k];
    }
    return k in store;
  };

  function exec([cmd, ...a]) {
    const c = String(cmd).toUpperCase();
    switch (c) {
      case "GET":
        return alive(a[0]) ? store[a[0]] : null;
      case "SET": {
        const [k, v, ...opts] = a;
        const nx = opts.map((o) => String(o).toUpperCase()).includes("NX");
        if (nx && alive(k)) return null;
        store[k] = String(v);
        const ex = opts.findIndex((o) => String(o).toUpperCase() === "EX");
        if (ex >= 0) expiries[k] = Date.now() + Number(opts[ex + 1]) * 1000;
        persist();
        return "OK";
      }
      case "DEL": {
        let n = 0;
        for (const k of a) if (alive(k)) (delete store[k], n++);
        persist();
        return n;
      }
      case "INCR": {
        const v = (alive(a[0]) ? Number(store[a[0]]) : 0) + 1;
        store[a[0]] = String(v);
        persist();
        return v;
      }
      case "EXPIRE": {
        if (!alive(a[0])) return 0;
        const nx = String(a[2] || "").toUpperCase() === "NX";
        if (nx && expiries[a[0]]) return 0;
        expiries[a[0]] = Date.now() + Number(a[1]) * 1000;
        return 1;
      }
      case "HSET": {
        const h = (store[a[0]] ||= {});
        let n = 0;
        for (let i = 1; i < a.length; i += 2) {
          if (!(a[i] in h)) n++;
          h[a[i]] = String(a[i + 1]);
        }
        persist();
        return n;
      }
      case "HGET":
        return store[a[0]]?.[a[1]] ?? null;
      case "HDEL": {
        const h = store[a[0]] || {};
        let n = 0;
        for (const f of a.slice(1)) if (f in h) (delete h[f], n++);
        persist();
        return n;
      }
      case "HGETALL":
        return Object.entries(store[a[0]] || {}).flat();
      case "FLUSHALL":
        store = {};
        persist();
        return "OK";
      default:
        throw new Error(`ERR unknown command '${cmd}' in mock`);
    }
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: "Unauthorized" }));
      }
      try {
        const parsed = JSON.parse(body);
        if (req.url === "/pipeline" || req.url === "/multi-exec") {
          return res.end(JSON.stringify(parsed.map((cmd) => {
            try {
              return { result: exec(cmd) };
            } catch (e) {
              return { error: e.message };
            }
          })));
        }
        res.end(JSON.stringify({ result: exec(parsed) }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${port}`, token })));
}
