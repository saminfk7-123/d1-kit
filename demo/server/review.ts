// PR のレビューの重さ（review_weight/review_weight.py の TypeScript 版）
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { KIT_ROOT, LOW_CONFIDENCE, loadEnv, request } from "./d1.ts";
import type { ReviewResult } from "../src/types.ts";

export const REVIEW_DIR = path.join(KIT_ROOT, "review_weight", "data", "express");

const DECISION_CRITERIA = [
  "No one is affected.",
  "Affects only maintainers, or the behavior users see does not change.",
  "Changes behavior only in a part that some users run, such as one optional feature or module.",
  "Changes behavior in a part that every user runs, even if the change only happens under a specific condition; or relates to security; or a mistake would be hard to undo.",
];

const PATH_FLOORS: [RegExp, number][] = [[/^diff --git a\/\.github\/workflows\/\S*(publish|release|deploy)/im, 3]];

const CATEGORIES = {
  typo_comment: "Typo fixes or comment edits only. No code behavior changes.",
  dev_docs: "Developer-facing docs: README, setup steps, contributing guide, directory layout, workflow rules.",
  reference_docs: "Docs for users or integrators: API reference, specs, user guides.",
  tests_only: "Adds, changes, or removes tests without touching production code.",
  ui_style: "Visual changes: layout, spacing, colors, styles.",
  feature_add: "Adds a new feature, screen, endpoint, or option.",
  logic_change: "Changes how an existing feature behaves.",
  shared_code: "Changes shared utilities, common components, or API contracts used from many places.",
  refactor: "Restructures code without intending to change behavior.",
  logging_monitoring: "Adds or changes logs, metrics, or alerts.",
  build_infra: "Build, CI, dependencies, configuration, deployment, or environment.",
  critical: "Authentication, permissions, payments, deletion of data, or database migrations.",
};

const SITUATION_AND_EVALUATION = {
  category: {
    type: "choice",
    instructions: "What kind of change is the main purpose of this pull request?",
    criteria: CATEGORIES,
  },
  behavior: {
    type: "noul",
    instructions: "Does this pull request change how the software behaves for its users at runtime?",
  },
  used_by_everyone: {
    type: "noul",
    instructions: "Does the changed part run in, or get shipped to, every user's app or install?",
  },
  conditional: {
    type: "noul",
    instructions:
      "Does the behavior change happen only under a specific condition, such as a particular HTTP method, header, option, or input? Answer no if the behavior does not change at all.",
  },
  security: {
    type: "noul",
    instructions:
      "Does this pull request fix or affect security, such as a vulnerability, authentication, permissions, or secrets?",
  },
  hard_to_undo: {
    type: "noul",
    instructions:
      "If this pull request contains a mistake, would it be hard to undo, such as deleted data, moved money, or a package version already published to users?",
  },
};

export function reviewLabels(): Record<string, number> {
  return JSON.parse(readFileSync(path.join(REVIEW_DIR, "labels.json"), "utf8"));
}

export function reviewText(id: string): string {
  return readFileSync(path.join(REVIEW_DIR, `${id}.txt`), "utf8");
}

function withContext(text: string): string {
  const file = path.join(REVIEW_DIR, "context.txt");
  return existsSync(file) ? `${readFileSync(file, "utf8")}\n\n${text}` : text;
}

function findings(ev: ReviewResult["evaluation"]): string {
  return [
    "Review findings from earlier checks:",
    `- Type of change: ${ev.category.choice}`,
    `- Probability that runtime behavior changes for users: ${ev.behavior.noul.toFixed(2)}`,
    `- Probability that the changed part runs in or ships to every user's app: ${ev.used_by_everyone.noul.toFixed(2)}`,
    `- Probability that the change happens only under a specific condition: ${ev.conditional.noul.toFixed(2)}`,
    `- Probability that it relates to security: ${ev.security.noul.toFixed(2)}`,
    `- Probability that a mistake would be hard to undo: ${ev.hard_to_undo.noul.toFixed(2)}`,
  ].join("\n");
}

export async function runReview(id: string): Promise<ReviewResult> {
  const env = loadEnv();
  const expected = reviewLabels()[id];
  const text = withContext(reviewText(id));

  const first = await request(env, text, SITUATION_AND_EVALUATION);
  const evaluation = first.answers as ReviewResult["evaluation"];
  const second = await request(env, `${text}\n\n${findings(evaluation)}`, {
    decision: {
      type: "score",
      instructions:
        "How carefully does a reviewer need to review this pull request? Use the review findings. Judge by who is affected and how badly.",
      criteria: DECISION_CRITERIA,
    },
  });
  const decision = second.answers.decision;

  const floor = Math.max(0, ...PATH_FLOORS.filter(([re]) => re.test(text)).map(([, level]) => level));
  const d1Level = Math.round(decision.score);
  const level = Math.max(d1Level, floor);
  const everyoneUnsure = evaluation.used_by_everyone.noul >= 0.3 && evaluation.used_by_everyone.noul <= 0.7;

  return {
    kind: "review",
    id,
    expected,
    evaluation,
    decision,
    d1Level,
    floor,
    level,
    // ルールで下限を決めた PR は、d1 が迷っていても人に回さない
    needsHuman: floor === 0 && (decision.confidence < LOW_CONFIDENCE || everyoneUnsure),
    correct: level === expected,
    tokens: first.usage.input_tokens + second.usage.input_tokens,
    seconds: first.elapsedSec + second.elapsedSec,
    ranAt: new Date().toISOString(),
  };
}
