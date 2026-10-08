// デモの一覧と、結果の保存・読み出し
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cdLabels, cdLines, runCd } from "./triage.ts";
import { reviewLabels, reviewText, runReview } from "./review.ts";
import { CAUSE_TEXT } from "../src/labels.ts";
import type { DemoItem, Kind, RunResult } from "../src/types.ts";

const CACHE_DIR = path.resolve(process.cwd(), "cache");

const TITLES: Record<Kind, Record<string, string>> = {
  review: {
    "express-7509": "コメントとテスト名の誤字修正",
    "express-7265": "trimRight() を trimEnd() に置き換え",
    "express-7366": "QUERY リクエストでも 304 を返せるようにする",
    "express-6464": "エラーログにエラー全体を出す",
    "express-7459": "res.send の ETag 生成を修正",
    "express-7390": "body-parser を更新して脆弱性を修正",
    "express-7465": "npm 公開用の CI ワークフローを追加",
  },
  aws: {
    "aws-01": "OIDC で AWS にログインできない",
    "aws-02": "Terraform で SQS の設定を変える権限がない",
    "aws-03": "Lambda 作成時に iam:PassRole の権限がない",
    "aws-04": "CDK の環境変数の名前が食い違っている",
    "aws-05": "シークレットの ARN 間違い（派手な巻き添えエラーつき）",
    "aws-06": "Docker ビルド中の TypeScript エラー",
    "aws-07": "Step Functions の定義が存在しない手順を指す",
    "aws-08": "Lambda API のレート制限（429）",
    "aws-09": "ECS のコンテナが Redis につながらず落ちる",
    "aws-10": "同じ名前の SQS キューがすでにある",
    "aws-11": "Lambda のロールにキューを読む権限がない（紛らわしい）",
    "aws-12": "ECS が安定しない（理由がログにない）",
  },
  snowflake: {
    "auth-01": "schemachange のパスワード違い",
    "auth-02": "Terraform の JWT が無効",
    "auth-03": "snow app deploy の OAuth トークン期限切れ",
    "authz-01": "スキーマを触る権限がない",
    "authz-02": "テーブルの所有者が別のロール",
    "authz-03": "アプリパッケージにバージョンを足す権限がない",
    "config-01": "環境変数 SNOWFLAKE_ACCOUNT がない",
    "config-02": "Terraform の変数が渡されていない",
    "build-01": "SQL の打ち間違い（FROM → FORM）",
    "build-02": "manifest.yml が指すファイルがない",
    "transient-01": "重いクエリの途中でタイムアウト",
    "transient-02": "Snowflake が一時的に 503",
    "ambiguous-01": "存在しないか権限がない（紛らわしい）",
    "ambiguous-02": "ウェアハウスが選ばれていない（紛らわしい）",
  },
};

const REVIEW_LEVEL_TEXT = ["0 誰にも影響しない", "1 メンテナだけ", "2 一部の利用者", "3 全員・重大"];

function cacheFile(kind: Kind, id: string): string {
  return path.join(CACHE_DIR, `${kind}-${id}.json`);
}

export function listDemos(): DemoItem[] {
  const items: DemoItem[] = [];
  for (const [id, expected] of Object.entries(reviewLabels())) {
    items.push({ kind: "review", id, title: TITLES.review[id] ?? id, expected: REVIEW_LEVEL_TEXT[expected], cached: existsSync(cacheFile("review", id)) });
  }
  for (const kind of ["aws", "snowflake"] as const) {
    for (const [id, expected] of Object.entries(cdLabels(kind))) {
      items.push({ kind, id, title: TITLES[kind][id] ?? id, expected: expected.map((c) => CAUSE_TEXT[c] ?? c).join(" / "), cached: existsSync(cacheFile(kind, id)) });
    }
  }
  return items;
}

export function demoInput(kind: Kind, id: string): string[] {
  return kind === "review" ? reviewText(id).split("\n") : cdLines(kind, id);
}

export function readCached(kind: Kind, id: string): RunResult | null {
  const file = cacheFile(kind, id);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export async function runLive(kind: Kind, id: string): Promise<RunResult> {
  const result = kind === "review" ? await runReview(id) : await runCd(kind, id);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile(kind, id), JSON.stringify(result, null, 2));
  return result;
}
