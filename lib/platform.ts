import path from "node:path";

/**
 * OS ごとの違いをまとめる。サーバは社員の PC 上で動くので、サーバの OS = 社員の OS。
 */
export interface PlatformInfo {
  os: "mac" | "windows" | "linux";
  /** 「ファイルの場所を開く」ボタンの文言 */
  revealLabel: string;
  /** パス区切り文字（「パスをコピー」で使う） */
  sep: string;
}

export function platformInfo(): PlatformInfo {
  switch (process.platform) {
    case "darwin":
      return { os: "mac", revealLabel: "Finderで表示", sep: path.sep };
    case "win32":
      return { os: "windows", revealLabel: "エクスプローラーで表示", sep: path.sep };
    default:
      return { os: "linux", revealLabel: "フォルダを開く", sep: path.sep };
  }
}

export interface RevealCommand {
  file: string;
  args: string[];
  /** Windows で引数をそのまま渡す（explorer は /select,"パス" の形しか受け付けないため） */
  windowsVerbatimArguments?: boolean;
  /** explorer.exe は成功しても終了コード 1 を返すので、終了コードを見ない */
  ignoreExitCode?: boolean;
}

/** 検証済みの絶対パスを受け取り、その場所をファイラーで開くコマンドを返す。ファイルには触れない */
export function revealCommand(absPath: string): RevealCommand {
  switch (process.platform) {
    case "darwin":
      return { file: "/usr/bin/open", args: ["-R", "--", absPath] };
    case "win32": {
      // Windows のパスには " を含められないので、引用符で囲めば安全に渡せる
      const explorer = path.join(process.env.SystemRoot ?? "C:\\Windows", "explorer.exe");
      return { file: explorer, args: [`/select,"${absPath}"`], windowsVerbatimArguments: true, ignoreExitCode: true };
    }
    default:
      // Linux にはファイルを選択状態で開く共通の方法がないので、フォルダを開く
      return { file: "xdg-open", args: [path.dirname(absPath)] };
  }
}
