// 発表前に全件をライブ実行して、結果を cache/ に保存する
// 使い方: npm run warm            （全件）
//         npm run warm -- aws     （種類を絞る: review / aws / snowflake）
//         npm run warm -- --missing  （まだ保存していないものだけ）
import { listDemos, runLive } from "./demos.ts";

const args = process.argv.slice(2);
const onlyMissing = args.includes("--missing");
const kinds = args.filter((a) => !a.startsWith("--"));

const targets = listDemos().filter((d) => (kinds.length === 0 || kinds.includes(d.kind)) && (!onlyMissing || !d.cached));
console.log(`${targets.length} 件を実行します`);

let failed = 0;
for (const [i, item] of targets.entries()) {
  try {
    const result = await runLive(item.kind, item.id);
    const ok = result.kind === "review" ? result.correct : result.causeCorrect;
    console.log(`[${i + 1}/${targets.length}] ${item.kind} ${item.id}  ${ok ? "OK" : "NG"}${result.needsHuman ? "  要人間" : ""}`);
  } catch (e) {
    failed++;
    console.log(`[${i + 1}/${targets.length}] ${item.kind} ${item.id}  失敗: ${e instanceof Error ? e.message : e}`);
  }
}
console.log(failed ? `${failed} 件失敗しました。npm run warm -- --missing で残りだけ再実行できます。` : "全件保存しました");
