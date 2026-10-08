// Liquid AI d1 の呼び出し。API キーはサーバー側（kit ルートの .env）だけで読み、ブラウザには渡さない
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// npm スクリプトは demo/ で動くので、その 1 つ上が kit のルート
export const KIT_ROOT = path.resolve(process.cwd(), "..");
export const LOW_CONFIDENCE = 0.6;
export const PRICE_PER_MILLION_INPUT = 0.04;

type Env = { LIQUID_API_KEY: string; LIQUID_BASE_URL: string; LIQUID_MODEL: string };

export function loadEnv(): Env {
  const file = path.join(KIT_ROOT, ".env");
  if (!existsSync(file)) {
    throw new Error("kit ルートに .env がありません。env.example を .env にコピーして LIQUID_API_KEY を設定してください。");
  }
  const env: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env as Env;
}

export type D1Response = {
  answers: Record<string, any>;
  usage: { input_tokens: number; output_tokens: number };
  elapsedSec: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function request(env: Env, state: string, questions: Record<string, unknown>): Promise<D1Response> {
  // d1:free のレート制限は厳しいので、間隔を空けつつ待ち時間を倍々に伸ばして粘る
  for (const wait of [5, 10, 20, 40, 60, null]) {
    const started = performance.now();
    const res = await fetch(`${env.LIQUID_BASE_URL}/decisions/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.LIQUID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.LIQUID_MODEL, state, questions }),
    });
    const elapsedSec = (performance.now() - started) / 1000;
    if (res.status === 429 && wait !== null) {
      console.log(`  レート制限にかかったので ${wait} 秒待って再試行`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`d1 が ${res.status} を返しました: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    await sleep(3000);
    return { ...data, elapsedSec };
  }
  throw new Error("unreachable");
}
