// サーバーと画面で共有する型

export type Kind = "review" | "aws" | "snowflake";

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
};

export type DemoItem = {
  kind: Kind;
  id: string;
  title: string;
  expected: string; // 画面に出す正解の表記
  cached: boolean;
};

export type ReviewResult = {
  kind: "review";
  id: string;
  expected: number;
  evaluation: {
    category: ChoiceAnswer;
    behavior: NoulAnswer;
    used_by_everyone: NoulAnswer;
    conditional: NoulAnswer;
    security: NoulAnswer;
    hard_to_undo: NoulAnswer;
  };
  decision: ScoreAnswer;
  d1Level: number;
  floor: number;
  level: number;
  needsHuman: boolean;
  correct: boolean;
  tokens: number;
  seconds: number;
  ranAt: string;
};

export type Candidate = { line: number; text: string; probability: number };

export type CdResult = {
  kind: "aws" | "snowflake";
  id: string;
  expected: string[];
  cause: ChoiceAnswer;
  causeCorrect: boolean;
  pick: { line: number; text: string; confidence: number; candidates: Candidate[] };
  rootLines: number[]; // 正解の原因の行（わかっている場合）
  repeatLines: number[]; // 同じ内容をくり返しているだけの行
  lineMark: "ok" | "repeat" | "ng" | "unknown";
  needsHuman: boolean;
  tokens: number;
  seconds: number;
  ranAt: string;
};

export type RunResult = ReviewResult | CdResult;
