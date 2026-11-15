// Development-only Supabase protocol adapter. Never deploy this server.
import http from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createDatabase, seed, asUser } from "./local-db.mjs";
await mkdir("./work", { recursive: true });
const db = await createDatabase("./work/local-pgdata");
await seed(db);
await mkdir("./work/mail", { recursive: true });
const sessions = new Map(),
  codes = new Map(),
  rate = new Map();
const port = Number(process.env.LOCAL_API_PORT || 4174);
const tables = new Map(
  (
    await db.query(
      "select table_name,array_agg(column_name)::text[] cols from information_schema.columns where table_schema='public' group by table_name",
    )
  ).rows.map((x) => [x.table_name, new Set(x.cols)]),
);
function user(id, email) {
  return {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    created_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
  };
}
function issueSession(row, id) {
  const token = [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: row.id,
        session_id: id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: "authenticated",
      }),
    ).toString("base64url"),
    randomBytes(32).toString("base64url"),
  ].join(".");
  const s = {
    access_token: token,
    refresh_token: randomBytes(32).toString("hex"),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: user(row.id, row.email),
    sid: id,
  };
  sessions.set(token, s);
  return s;
}
async function mailPass() {
  let o = (await db.query("select public.training_mail_claim() v")).rows[0].v;
  if (!o) return;
  try {
    if (!o.email.endsWith(".test"))
      throw Error("Local mail only accepts .test recipients");
    await writeFile(`./work/mail/${o.id}.json`, JSON.stringify(o, null, 2));
    await db.query("select public.training_mail_ack($1)", [o.id]);
  } catch (e) {
    await db.query("select public.training_mail_ack($1,$2)", [o.id, e.message]);
  }
}
const timer = setInterval(
  () => mailPass().catch((e) => console.error("local worker", e.message)),
  30000,
);
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (
    origin &&
    !/^http:\/\/(localhost|127\.0\.0\.1):(5173|4173|4174)$/.test(origin)
  ) {
    res.writeHead(403);
    res.end();
    return;
  }
  res.setHeader(
    "Access-Control-Allow-Origin",
    origin || "http://127.0.0.1:5173",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,apikey,content-type,content-profile,accept-profile,x-client-info,prefer,accept,range,x-supabase-api-version",
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1");
  let body = {};
  let status = 200;
  function send(v) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(v));
  }
  try {
    if (req.method !== "GET") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4_000_000) throw Error("Payload too large");
      }
      body = raw ? JSON.parse(raw) : {};
    }
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const candidate = sessions.get(token);
    const session =
      candidate && candidate.expires_at > Math.floor(Date.now() / 1000)
        ? candidate
        : null;
    if (url.pathname === "/local/inbox") {
      return send(
        await Promise.all(
          (await readdir("./work/mail"))
            .filter((x) => x.endsWith(".json"))
            .map(async (x) =>
              JSON.parse(await readFile("./work/mail/" + x, "utf8")),
            ),
        ),
      );
    }
    if (url.pathname === "/auth/v1/otp") {
      const email = body.email?.toLowerCase();
      if (!email?.endsWith("@example.test"))
        throw Error("Local login accepts @example.test only");
      const row = (
        await db.query(
          "select * from public.employees where lower(email::text)=$1 and active",
          [email],
        )
      ).rows[0];
      if (!row) throw Error("Employee not active");
      if (Date.now() - (rate.get(email) || 0) < 1000)
        throw Error("Please wait");
      rate.set(email, Date.now());
      await db.query(
        "insert into auth.users(email) select $1 where not exists(select 1 from auth.users where email=$1)",
        [email],
      );
      const code = String(randomInt(100000, 1000000));
      codes.set(email, { code, expires: Date.now() + 300000, attempts: 0 });
      await writeFile(
        `./work/mail/otp-${email}.json`,
        JSON.stringify({ email, code, localOnly: true }, null, 2),
      );
      return send({});
    }
    if (url.pathname === "/auth/v1/verify") {
      const code = codes.get(body.email);
      if (
        !code ||
        Date.now() > code.expires ||
        ++code.attempts > 5 ||
        code.code !== body.token
      )
        throw Error("Invalid OTP");
      codes.delete(body.email);
      const row = (
        await db.query(
          "select u.* from auth.users u join public.employees e on e.user_id=u.id where u.email=$1 and e.active",
          [body.email],
        )
      ).rows[0];
      const id = (
        await db.query(
          "insert into auth.sessions(user_id) values($1) returning id",
          [row.id],
        )
      ).rows[0].id;
      return send(issueSession(row, id));
    }
    if (
      url.pathname === "/auth/v1/token" &&
      url.searchParams.get("grant_type") === "refresh_token"
    ) {
      const old = [...sessions.values()].find(
        (x) => x.refresh_token === body.refresh_token,
      );
      if (!old) throw Error("Invalid refresh token");
      const row = (
        await db.query(
          "select u.* from auth.users u join public.employees e on e.user_id=u.id join auth.sessions s on s.user_id=u.id where s.id=$1 and e.active",
          [old.sid],
        )
      ).rows[0];
      if (!row) throw Error("Session revoked");
      sessions.delete(old.access_token);
      return send(issueSession(row, old.sid));
    }
    if (url.pathname.startsWith("/auth/v1/") && !session) {
      status = 401;
      throw Error("Session missing");
    }
    if (url.pathname === "/auth/v1/user") return send(session.user);
    if (url.pathname === "/auth/v1/logout") {
      if (url.searchParams.get("scope") === "others") {
        for (const [t, s] of sessions)
          if (s.user.id === session.user.id && s.sid !== session.sid)
            sessions.delete(t);
      } else {
        for (const [t, s] of sessions)
          if (s.sid === session.sid) sessions.delete(t);
        await db.query("delete from auth.sessions where id=$1", [session.sid]);
      }
      return send({});
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      if (!/^[a-z_]+$/.test(name) || name.startsWith("training_mail"))
        throw Error("RPC unavailable");
      if (!session && name !== "is_login_email_allowed") {
        status = 401;
        throw Error("Login required");
      }
      const call = async (tx) => {
        const def = (
          await tx.query(
            "select p.proargnames, p.proargtypes::oid[] as types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 limit 1",
            [name],
          )
        ).rows[0];
        if (!def) throw Error("RPC not found");
        const args = [],
          values = [];
        for (const key of Object.keys(body)) {
          const idx = def.proargnames?.indexOf(key);
          if (idx === undefined || idx < 0) throw Error("Unknown argument");
          const type = (
            await tx.query("select format_type($1,null) t", [def.types[idx]])
          ).rows[0].t;
          values.push(
            typeof body[key] === "object"
              ? JSON.stringify(body[key])
              : body[key],
          );
          args.push(`"${key}"=>$${values.length}::${type}`);
        }
        return (
          await tx.query(`select public."${name}"(${args.join(",")}) v`, values)
        ).rows[0].v;
      };
      return send(
        session
          ? await asUser(db, session.user.id, session.sid, call)
          : await db.transaction(async (tx) => {
              await tx.exec("set local role anon");
              return call(tx);
            }),
      );
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      if (!session) {
        status = 401;
        throw Error("Login required");
      }
      const table = url.pathname.split("/").at(-1);
      const cols = tables.get(table);
      if (!cols) throw Error("Unknown table");
      const values = [];
      const param = (v) => {
        values.push(v);
        return "$" + values.length;
      };
      const col = (s) => {
        if (!cols.has(s)) throw Error("Unknown column " + s);
        return '"' + s + '"';
      };
      const select = url.searchParams.get("select") || "*";
      const selection =
        select === "*" ? "*" : select.split(",").map(col).join(",");
      let where = [];
      for (const [k, v] of url.searchParams) {
        if (["select", "order", "limit", "on_conflict", "offset"].includes(k))
          continue;
        const [op, ...rest] = v.split(".");
        const val = rest.join(".");
        const column = col(k);
        if (
          ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike"].includes(op)
        )
          where.push(
            column +
              " " +
              {
                eq: "=",
                neq: "<>",
                gt: ">",
                gte: ">=",
                lt: "<",
                lte: "<=",
                like: "like",
                ilike: "ilike",
              }[op] +
              " " +
              param(val),
          );
        else if (op === "is" && val === "null") where.push(column + " is null");
        else if (op === "in") {
          where.push(
            column +
              " in (" +
              val
                .replace(/^\(|\)$/g, "")
                .split(",")
                .map(param)
                .join(",") +
              ")",
          );
        } else throw Error("Unsupported filter");
      }
      let sql;
      const suffix = where.length ? " where " + where.join(" and ") : "";
      if (req.method === "GET")
        sql =
          `select ${selection} from public."${table}"${suffix}` +
          (url.searchParams.get("order")
            ? " order by " +
              url.searchParams
                .get("order")
                .split(",")
                .map((s) => {
                  const [c, d] = s.split(".");
                  return col(c) + (d === "desc" ? " desc" : " asc");
                })
                .join(",")
            : "") +
          (url.searchParams.has("limit")
            ? " limit " + param(Number(url.searchParams.get("limit")))
            : "");
      else if (req.method === "DELETE")
        sql = `delete from public."${table}"${suffix} returning ${selection}`;
      else if (req.method === "PATCH")
        sql =
          `update public."${table}" set ` +
          Object.keys(body)
            .map((k) => col(k) + "=" + param(body[k]))
            .join(",") +
          suffix +
          ` returning ${selection}`;
      else {
        const rows = Array.isArray(body) ? body : [body];
        const keys = Object.keys(rows[0]);
        sql =
          `insert into public."${table}" (${keys.map(col)}) values ` +
          rows
            .map((row) => "(" + keys.map((k) => param(row[k])).join(",") + ")")
            .join(",");
        if (req.headers.prefer?.includes("resolution=merge-duplicates"))
          sql +=
            " on conflict (" +
            (url.searchParams.get("on_conflict") || "id")
              .split(",")
              .map(col)
              .join(",") +
            ") do update set " +
            keys.map((k) => col(k) + "=excluded." + col(k)).join(",");
        sql += ` returning ${selection}`;
      }
      const data = await asUser(
        db,
        session.user.id,
        session.sid,
        async (tx) => (await tx.query(sql, values)).rows,
      );
      if (req.headers.accept?.includes("vnd.pgrst.object")) {
        if (data.length !== 1) {
          status = 406;
          return send({
            code: "PGRST116",
            message: "Expected one row",
            details: data.length + " rows",
          });
        }
        return send(data[0]);
      }
      return send(data);
    }
    status = 404;
    send({ message: "Not found" });
  } catch (e) {
    status = status === 200 ? 400 : status;
    send({
      message: e.message,
      code: e.code || "LOCAL_ERROR",
      error_description: e.message,
    });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Local test API http://127.0.0.1:${port}; mail inbox /local/inbox. Test employees only.`,
  ),
);
const vite = process.argv.includes("--api-only")
  ? null
  : spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          VITE_SUPABASE_URL: `http://127.0.0.1:${port}`,
          VITE_SUPABASE_PUBLISHABLE_KEY: "local-test-key",
          VITE_LOCAL_TEST: "true",
        },
      },
    );
async function stop() {
  clearInterval(timer);
  vite?.kill();
  server.close();
  await db.close();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
