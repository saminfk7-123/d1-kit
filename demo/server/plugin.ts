// Vite の開発サーバーに API を足すプラグイン。d1 はここからだけ呼ぶ（API キーをブラウザに出さない）
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { demoInput, listDemos, readCached, runLive } from "./demos.ts";
import type { Kind } from "../src/types.ts";

const KINDS: Kind[] = ["review", "aws", "snowflake"];

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function parseTarget(kind: unknown, id: unknown): { kind: Kind; id: string } {
  if (!KINDS.includes(kind as Kind) || typeof id !== "string" || !/^[\w-]+$/.test(id)) {
    throw new Error("kind か id が正しくありません");
  }
  return { kind: kind as Kind, id };
}

export function apiPlugin(): Plugin {
  return {
    name: "d1-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const url = new URL(req.url, "http://localhost");
        try {
          if (req.method === "GET" && url.pathname === "/api/demos") {
            return send(res, 200, listDemos());
          }
          if (req.method === "GET" && url.pathname === "/api/input") {
            const { kind, id } = parseTarget(url.searchParams.get("kind"), url.searchParams.get("id"));
            return send(res, 200, { lines: demoInput(kind, id) });
          }
          if (req.method === "POST" && url.pathname === "/api/run") {
            const body = await readJson(req);
            const { kind, id } = parseTarget(body.kind, body.id);
            if (body.mode === "cached") {
              const cached = readCached(kind, id);
              return cached ? send(res, 200, cached) : send(res, 404, { error: "保存済みの結果がありません。ライブで実行してください。" });
            }
            return send(res, 200, await runLive(kind, id));
          }
          return send(res, 404, { error: "not found" });
        } catch (e) {
          return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
