// CD 失敗の原因（cd_triage/triage.py の TypeScript 版）
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { KIT_ROOT, LOW_CONFIDENCE, loadEnv, request } from "./d1.ts";
import type { CdResult, Candidate } from "../src/types.ts";

const DATA = path.join(KIT_ROOT, "cd_triage", "data");

type Profile = { tailLines: number | null; context: string; categories: Record<string, string> };

const PROFILES: Record<"aws" | "snowflake", Profile> = {
  snowflake: {
    tailLines: 200,
    context:
      "This is the log of a failed CD job. The pipeline deploys to Snowflake using schemachange (SQL migration scripts), Terraform with the Snowflake provider, and Snowflake CLI (snow app deploy) for a Snowflake Native App.",
    categories: {
      auth: "Authentication: cannot log in. Wrong or expired password, key pair, JWT, or OAuth token.",
      authorization: "Authorization: logged in, but the role lacks a privilege. Missing grant, warehouse usage, or object ownership.",
      config: "Configuration: a missing or wrong environment variable, secret, variable value, or object name in the pipeline settings.",
      build: "Build: the code or artifacts themselves are broken. SQL syntax errors, invalid manifest or project definition, missing files.",
      transient: "Transient: a temporary problem that may succeed on retry. Timeouts, network errors, service unavailable.",
    },
  },
  aws: {
    tailLines: null,
    context:
      "This is the full log of a failed CD job on GitHub Actions. It deploys 4 apps to AWS: order-api (API Gateway, Lambda, SQS) and report-batch (Step Functions, Lambda, ECS task) with AWS CDK, web-backend (ECS Fargate service behind an ALB) with docker build and the ECS deploy action, and notification (SQS, Lambda) with Terraform. Most lines are normal successful output. Find the first error that actually caused the failure; later errors and rollback lines are often consequences.",
    categories: {
      auth: "Authentication: cannot obtain credentials or log in. OIDC role assumption rejected, expired or invalid credentials.",
      authorization: "Authorization: credentials work, but a role lacks a permission. AccessDenied, not authorized to perform an action, iam:PassRole.",
      config: "Configuration: a missing or wrong environment variable, secret, parameter, ARN, or name in the pipeline or app settings.",
      build: "Build: the code or artifacts themselves are broken. Compile errors, Docker or npm build failures, invalid templates or state machine definitions.",
      transient: "Transient: a temporary problem that may succeed on retry. Throttling, rate exceeded, timeouts, 5xx, network errors.",
      runtime: "Runtime: the deploy itself went through, but the app fails to start or pass health checks. Containers exiting, failing health checks.",
      resource_state: "Resource state: conflicts with existing resources or their state. Already exists, stack stuck in a failed state, quota or limit exceeded.",
    },
  },
};

const ERRORISH =
  /error|fail|denied|not authorized|exception|fatal|refused|invalid|exceeded|timed out|timeout|unhealthy|stopped|exit code|already exists|can't|cannot|not found|missing|unable|rate exceeded|\b(403|429|5\d\d)\b/i;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
const MAX_CHOICES = 255;
const MAX_CHARS = 300;

export function cdLabels(kind: "aws" | "snowflake"): Record<string, string[]> {
  return JSON.parse(readFileSync(path.join(DATA, kind, "labels.json"), "utf8"));
}

// 画面に出すログ（Snowflake は末尾 200 行だけを使うので、そこだけ返す。行番号もこの範囲で数える）
export function cdLines(kind: "aws" | "snowflake", id: string): string[] {
  const lines = readFileSync(path.join(DATA, kind, `${id}.log`), "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const tail = PROFILES[kind].tailLines;
  return tail ? lines.slice(-tail) : lines;
}

function truth(kind: "aws" | "snowflake", id: string): { root: number[]; repeat: number[] } {
  const file = path.join(DATA, kind, "root_lines.json");
  if (!existsSync(file)) return { root: [], repeat: [] };
  const all = JSON.parse(readFileSync(file, "utf8"));
  return { root: all.root[id] ?? [], repeat: all.repeat[id] ?? [] };
}

function candidates(lines: string[]): Record<string, string> {
  const found: Record<string, string> = {};
  lines.forEach((line, i) => {
    const body = line.replace(TIMESTAMP, "").trim();
    if (body && ERRORISH.test(body) && Object.keys(found).length < MAX_CHOICES) {
      found[`L${i + 1}`] = body.slice(0, MAX_CHARS);
    }
  });
  return found;
}

export async function runCd(kind: "aws" | "snowflake", id: string): Promise<CdResult> {
  const env = loadEnv();
  const profile = PROFILES[kind];
  const expected = cdLabels(kind)[id];
  const lines = cdLines(kind, id);

  // 1. 原因の分類
  const first = await request(env, `${profile.context}\n\n${lines.join("\n")}`, {
    cause: {
      type: "choice",
      instructions: "What is the most likely root cause of this CD failure?",
      criteria: profile.categories,
    },
  });
  const cause = first.answers.cause;

  // 2. 原因の行の特定（コードが候補を抜き出し、d1 が選ぶ。選択肢のキー = 行番号）
  const choices = candidates(lines);
  const numbered = lines.map((l, i) => `${i + 1}: ${l.replace(TIMESTAMP, "")}`).join("\n");
  const second = await request(env, `${profile.context}\n\n${numbered}`, {
    root_line: {
      type: "choice",
      instructions:
        "Which line is the first error that actually caused this CD failure? Lines that repeat it in a summary, cancelled resources, rollback lines, and generic 'exit code' lines are consequences, not the root cause.",
      criteria: choices,
    },
  });
  const pickAnswer = second.answers.root_line;
  const picked = Number(pickAnswer.choice.slice(1));
  const candidateList: Candidate[] = Object.entries(choices).map(([key, text]) => ({
    line: Number(key.slice(1)),
    text,
    probability: pickAnswer.probabilities?.[key] ?? 0,
  }));

  const { root, repeat } = truth(kind, id);
  const lineMark = root.length === 0 ? "unknown" : root.includes(picked) ? "ok" : repeat.includes(picked) ? "repeat" : "ng";

  return {
    kind,
    id,
    expected,
    cause,
    causeCorrect: expected.includes(cause.choice),
    pick: { line: picked, text: choices[pickAnswer.choice], confidence: pickAnswer.confidence, candidates: candidateList },
    rootLines: root,
    repeatLines: repeat,
    lineMark,
    needsHuman: Math.min(cause.confidence, pickAnswer.confidence) < LOW_CONFIDENCE,
    tokens: first.usage.input_tokens + second.usage.input_tokens,
    seconds: first.elapsedSec + second.elapsedSec,
    ranAt: new Date().toISOString(),
  };
}
