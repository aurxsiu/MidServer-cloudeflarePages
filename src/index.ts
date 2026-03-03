export interface Env {
  MID_KV: KVNamespace;
}

type State = "idle" | "waiting_response" | "response_ready";

interface Meta {
  seq: number;
  state: State;
  updatedAt: number; // ms
}

const DEFAULT_CHANNEL = "default";
const META_KEY = (ch: string) => `meta:${ch}`;
const REQ_KEY = (ch: string) => `req:${ch}`;
const RES_KEY = (ch: string) => `res:${ch}`;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

async function getMeta(env: Env, channel: string): Promise<Meta> {
  const meta = await env.MID_KV.get<Meta>(META_KEY(channel), "json");
  if (meta && typeof meta.seq === "number" && typeof meta.state === "string") return meta;
  const init: Meta = { seq: 0, state: "idle", updatedAt: Date.now() };
  await env.MID_KV.put(META_KEY(channel), JSON.stringify(init));
  return init;
}

async function setMeta(env: Env, channel: string, meta: Meta) {
  await env.MID_KV.put(META_KEY(channel), JSON.stringify(meta));
}

function getChannel(url: URL) {
  const ch = url.searchParams.get("channel") || DEFAULT_CHANNEL;
  return ch.slice(0, 64);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const channel = getChannel(url);
    const { pathname } = url;

    if (request.method === "GET" && pathname === "/health") {
      const meta = await getMeta(env, channel);
      return json({ ok: true, channel, meta });
    }

    if (request.method === "POST" && pathname === "/send") {
      const meta = await getMeta(env, channel);
      if (meta.state !== "idle") return json({ error: "busy", meta }, 409);

      const body = await request.arrayBuffer();
      const seq = meta.seq + 1;

      const ttlSeconds = 60 * 10;
      await env.MID_KV.put(REQ_KEY(channel), body, { expirationTtl: ttlSeconds });

      const next: Meta = { seq, state: "waiting_response", updatedAt: Date.now() };
      await setMeta(env, channel, next);

      return json({ seq, state: next.state });
    }

    if (request.method === "GET" && pathname === "/poll") {
      const meta = await getMeta(env, channel);
      if (meta.state !== "waiting_response") return new Response("", { status: 204 });

      const reqBody = await env.MID_KV.get(REQ_KEY(channel), "arrayBuffer");
      if (!reqBody) return new Response("", { status: 204 });

      return new Response(reqBody, {
        status: 200,
        headers: {
          "X-Seq": String(meta.seq),
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
        },
      });
    }

    if (request.method === "POST" && pathname === "/reply") {
      const seqParam = url.searchParams.get("seq");
      if (!seqParam) return json({ error: "missing seq" }, 400);
      const clientSeq = Number(seqParam);
      if (!Number.isFinite(clientSeq)) return json({ error: "invalid seq" }, 400);

      const meta = await getMeta(env, channel);
      if (meta.state !== "waiting_response" || meta.seq !== clientSeq) {
        return json({ error: "invalid seq or state", meta }, 409);
      }

      const resBody = await request.arrayBuffer();
      const ttlSeconds = 60 * 10;
      await env.MID_KV.put(RES_KEY(channel), resBody, { expirationTtl: ttlSeconds });

      const next: Meta = { seq: meta.seq, state: "response_ready", updatedAt: Date.now() };
      await setMeta(env, channel, next);

      return json({ ok: true, seq: meta.seq, state: next.state });
    }

    if (request.method === "GET" && pathname === "/result") {
      const seqParam = url.searchParams.get("seq");
      if (!seqParam) return json({ error: "missing seq" }, 400);
      const clientSeq = Number(seqParam);
      if (!Number.isFinite(clientSeq)) return json({ error: "invalid seq" }, 400);

      const meta = await getMeta(env, channel);
      if (meta.seq !== clientSeq) return json({ error: "seq mismatch", meta }, 409);
      if (meta.state !== "response_ready") return json({ state: meta.state, seq: meta.seq }, 202);

      const resBody = await env.MID_KV.get(RES_KEY(channel), "arrayBuffer");
      if (!resBody) return json({ error: "missing response body" }, 500);

      await env.MID_KV.delete(REQ_KEY(channel));
      await env.MID_KV.delete(RES_KEY(channel));
      const next: Meta = { seq: meta.seq, state: "idle", updatedAt: Date.now() };
      await setMeta(env, channel, next);

      return new Response(resBody, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

