// OMP Worker 破壊的コマンドガード（OMP `tool_call` hook）
//
// Pi の拡張 `~/.pi/agent/extensions/destructive-guard.ts`（dotfiles の
// `agents/claude` サブモジュールが配備する Claude hook と同じルール表）から
// 移植したもの。
// OMP は既定の承認モードが `yolo` で破壊的ガードを持たないため、Worker
// スロットの role/permission 境界を保つにはこの拡張を
// `--trusted-extension` で明示的に読み込む必要がある。
//
// ルールは Claude hook / native Pi 側のコピーと同期させること。依存を持たない
// （runtime import なし）。
// 既知の未カバー（元ルールからの継承、この移植では変更しない）:
//   - `git push -d`（短縮形の remote 参照削除。長形式 --delete は対象）
//   - `git branch -d -f`（短縮 -d と -f の組み合わせ。`-D` と長形式は対象）
//
//   - rm -rf / rm -fr 等の再帰 + force 削除
//   - git push --force / -f / --force-with-lease / --delete（長形式）/ +ref:dst 強制 push
//   - git reset --hard
//   - git clean の -f 系（-n / --dry-run は許可）
//   - git checkout -- / git checkout . / git checkout -f
//   - git restore（--staged のみは許可）
//   - git branch -D / --delete --force
//   - git tag -d / --delete
//   - git stash drop / clear

type ToolCallEvent = { toolName: string; input?: Record<string, unknown> };

type ExtensionApi = {
  on(event: "tool_call", handler: (event: ToolCallEvent) => unknown): void;
};

const QUOTES = "`$();&|'\"";

function flagsFrom(tokens: string[], start: number): string[] {
  const out: string[] = [];
  for (const tok of tokens.slice(start)) {
    if (tok.startsWith("-") && tok !== "-") out.push(tok);
    else break;
  }
  return out;
}

function flagLetters(flags: string[]): string[] {
  return flags.map((f) => f.replace(/^-+/, "").toLowerCase());
}

function hasFlag(flags: string[], letter: string, longName: string): boolean {
  return flagLetters(flags).some((x) => x.includes(letter) || x.includes(longName));
}

function isRmRecursiveForce(tokens: string[], idx: number): boolean {
  // Short clusters (`-rf`, `-fr`) and the exact long options only. Substring
  // matching on lowercased long flags made `rm --preserve-root -f file` count
  // as recursive+force (a false block).
  let recursive = false;
  let forced = false;
  for (const flag of flagsFrom(tokens, idx + 1)) {
    if (flag.startsWith("--")) {
      const name = flag.slice(2).toLowerCase();
      if (name === "recursive") recursive = true;
      else if (name === "force") forced = true;
      continue;
    }
    const letters = flag.slice(1).toLowerCase();
    if (letters.includes("r")) recursive = true;
    if (letters.includes("f")) forced = true;
  }
  return recursive && forced;
}

function gitSubcommand(tokens: string[], idx: number): string | undefined {
  const skipWithValue = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
  let skipNext = false;
  for (const tok of tokens.slice(idx + 1)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (skipWithValue.has(tok)) {
      skipNext = true;
      continue;
    }
    if (tok.startsWith("-")) continue;
    return tok;
  }
  return undefined;
}

function checkGit(tokens: string[], idx: number): string | undefined {
  const rest = tokens.slice(idx + 1);
  const sub = gitSubcommand(tokens, idx);
  if (!sub) return undefined;

  switch (sub) {
    case "push": {
      for (const tok of rest) {
        if (tok.startsWith("-")) {
          if (tok.includes("force")) return "git push の強制 push（--force / --force-with-lease）は禁止";
          if (tok.includes("--delete")) return "git push --delete による remote 参照の削除は禁止";
          if (tok.startsWith("-f")) return "git push -f による強制 push は禁止";
        } else if (tok.startsWith("+") && tok.includes(":")) {
          return "git push の +ref:dst 強制 refspec は禁止";
        }
      }
      return undefined;
    }
    case "reset": {
      if (rest.includes("--hard")) return "git reset --hard は作業ツリーを破棄するため禁止";
      return undefined;
    }
    case "clean": {
      // Exact long options and short clusters only: `--exclude=vendor`
      // contains an `n`, so substring matching counted it as dry-run and
      // `git clean -fd --exclude=vendor` slipped past the guard (a real
      // bypass that deletes untracked files).
      let dry = false;
      let forced = false;
      for (const flag of flagsFrom(tokens, idx + 2)) {
        if (flag.startsWith("--")) {
          const name = flag.slice(2).toLowerCase();
          if (name === "dry-run") dry = true;
          else if (name === "force") forced = true;
          continue;
        }
        const letters = flag.slice(1).toLowerCase();
        if (letters.includes("n")) dry = true;
        if (letters.includes("f")) forced = true;
      }
      if (forced && !dry) {
        return "git clean -f 系（未追跡ファイル削除）は -n / --dry-run を伴わない限り禁止";
      }
      return undefined;
    }
    case "checkout": {
      const flags = flagsFrom(tokens, idx + 2);
      if (hasFlag(flags, "f", "force")) return "git checkout -f はローカルの変更を破棄するため禁止";
      const tail = tokens.slice(idx + 2);
      if (tail.includes("--")) return "git checkout -- による変更の破棄は禁止";
      const args = tail.filter((t) => !t.startsWith("-"));
      if (args.some((t) => t === "." || t === ".." || t.startsWith("./") || t.startsWith("../"))) {
        return "git checkout . による変更の破棄は禁止";
      }
      return undefined;
    }
    case "restore": {
      const tail = tokens.slice(idx + 2);
      if (tail.some((t) => t.startsWith("--worktree"))) {
        return "git restore --worktree は作業ツリーを破棄するため禁止";
      }
      if (!tail.some((t) => t.startsWith("--staged"))) {
        return "git restore（作業ツリー復元）は --staged 伴いのみ許可";
      }
      return undefined;
    }
    case "branch": {
      const tail = tokens.slice(idx + 2);
      if (tail.includes("-D") || (tail.includes("--delete") && tail.includes("--force"))) {
        return "git branch -D（未マージ分岐の強制削除）は禁止";
      }
      return undefined;
    }
    case "tag": {
      const tail = tokens.slice(idx + 2);
      if (tail.includes("-d") || tail.includes("--delete")) return "git tag -d（タグ削除）は禁止";
      return undefined;
    }
    case "stash": {
      const tail = tokens.slice(idx + 2);
      if (tail.includes("drop") || tail.includes("clear")) {
        return "git stash drop / clear（退避済み変更の破棄）は禁止";
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function checkSegment(segment: string): string | undefined {
  const tokens = segment.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const base = stripQuotes(tokens[i]).split("/").pop();
    if (base === "rm" && isRmRecursiveForce(tokens, i)) {
      return "rm の再帰 + force 削除（rm -rf / rm -fr 等）は禁止";
    }
    if (base === "git") {
      const reason = checkGit(tokens, i);
      if (reason) return reason;
    }
  }
  return undefined;
}

function stripQuotes(token: string): string {
  let out = token;
  while (out.length > 0 && QUOTES.includes(out[0])) out = out.slice(1);
  while (out.length > 0 && QUOTES.includes(out[out.length - 1])) out = out.slice(0, -1);
  return out;
}

export function checkCommand(command: string): string | undefined {
  // シェル演算子で分割し、&& や ; や サブシェル内の rm も検査する
  const segments = command.split(/&&|\|\||[;|\n]/);
  for (const segment of segments) {
    const reason = checkSegment(segment);
    if (reason) return reason;
  }
  return undefined;
}

export default function destructiveGuard(pi: ExtensionApi): void {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return;
    const command = (event.input as { command?: unknown } | undefined)?.command;
    if (typeof command !== "string" || command.trim() === "") return;

    const reason = checkCommand(command);
    if (reason) {
      return {
        block: true,
        reason: `destructive-guard: ${reason}\n破壊的な操作は自動実行できません。必要な場合はユーザーへ確認を取ってください。`,
      };
    }
  });
}
