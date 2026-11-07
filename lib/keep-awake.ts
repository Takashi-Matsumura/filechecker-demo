import { spawn, type ChildProcess } from "node:child_process";

/**
 * 棚卸し・評価の間、PC がアイドルでスリープしないようにする。
 * 処理の途中でスリープに入ると、ローカル LLM（llama-server）も止まり、AI の呼び出しがタイムアウトして
 * 結果が欠ける（氏名の確認の失敗など）。画面が消えるのは止めない。
 * -i はアイドルによるスリープを、-s は電源につないでいる間のシステムのスリープを止める。-i だけでは、画面が消えたあとに
 * Mac が一時的に起きて（ダークウェイク）自動で眠り直すのを止められず、評価の途中で 12 分止まったことがある。
 * mac は caffeinate を使う。Windows・Linux は今のところ何もしない（電源の設定でスリープを止めてもらう）。
 * 同時に複数の棚卸しが走ることがあるので、数を数えて、すべて終わったら解除する。
 */

interface AwakeState {
  count: number;
  child: ChildProcess | null;
}

// 開発中はモジュールが読み込み直されることがあるので、状態は globalThis に置く
const g = globalThis as unknown as { __fcAwake?: AwakeState };
const state = (): AwakeState => (g.__fcAwake ??= { count: 0, child: null });

/** スリープを止める。戻り値の関数を呼ぶと解除する（何度呼んでもよい） */
export function keepAwake(): () => void {
  const s = state();
  s.count++;
  if (s.count === 1 && process.platform === "darwin") {
    try {
      // -w: このアプリのプロセスが終わったら caffeinate も終わる（解除し忘れても残らない）
      const child = spawn("/usr/bin/caffeinate", ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore" });
      child.on("error", () => {
        // caffeinate が無い・起動できない場合は、スリープを止めずに続ける
        if (s.child === child) s.child = null;
      });
      child.unref();
      s.child = child;
    } catch {
      // 同上
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    s.count--;
    if (s.count === 0 && s.child) {
      s.child.kill();
      s.child = null;
    }
  };
}

/** スリープを止めている caffeinate のプロセス ID（テスト用）。止めていなければ null */
export function keepAwakePid(): number | null {
  return state().child?.pid ?? null;
}
