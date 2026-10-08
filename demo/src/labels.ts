// 画面に出す日本語のラベル

export const REVIEW_LEVELS = [
  "0 誰にも影響しない",
  "1 メンテナだけ／挙動は変わらない",
  "2 一部の利用者の挙動が変わる",
  "3 全員の挙動が変わる・重大",
];

export const CATEGORY_TEXT: Record<string, string> = {
  typo_comment: "誤字・コメント",
  dev_docs: "開発者向けドキュメント",
  reference_docs: "利用者向けドキュメント",
  tests_only: "テストだけ",
  ui_style: "見た目",
  feature_add: "機能追加",
  logic_change: "既存ロジックの変更",
  shared_code: "共通コード",
  refactor: "リファクタ",
  logging_monitoring: "ログ・監視",
  build_infra: "ビルド・CI・依存",
  critical: "認証・決済・削除・移行",
};

export const NOUL_TEXT: Record<string, string> = {
  behavior: "利用者から見た動作が変わるか",
  used_by_everyone: "全員が使う部分か",
  conditional: "特定の条件のときだけの変化か",
  security: "セキュリティに関わるか",
  hard_to_undo: "間違えたら取り返しがつきにくいか",
};

export const CAUSE_TEXT: Record<string, string> = {
  auth: "認証",
  authorization: "認可",
  config: "設定値",
  build: "ビルド",
  transient: "一時的",
  runtime: "起動失敗",
  resource_state: "リソースの状態",
};

export const KIND_TEXT = {
  review: "PR レビューの重さ",
  aws: "CD 失敗の原因（AWS）",
  snowflake: "CD 失敗の原因（Snowflake）",
} as const;

export const KIND_NOTE = {
  review: "Express の実際の PR（差分 + 影響範囲メモ）",
  aws: "架空の長いデプロイログ（248〜366 行）",
  snowflake: "架空の短いデプロイログ",
} as const;
