# 実成果物への違反混入

Node.js 22.18以降で、Skillと一緒に配布されるスクリプトを実行する。

```sh
node <installed-skill>/scripts/challenge.mts <source-directory> <trusted-suite.json>
```

suite例:

```json
{
  "command": ["node", "check.mjs"],
  "timeoutMs": 10000,
  "cases": [
    {
      "id": "forbidden-dependency",
      "expect": "reject",
      "diagnostic": "FORBIDDEN_DEPENDENCY",
      "patches": [{"path": "src/client.js", "before": "from './api.js'", "after": "from './internal.js'"}]
    },
    {
      "id": "valid-refactor",
      "expect": "accept",
      "patches": [{"path": "src/client.js", "before": "const value = 1;", "after": "const value = 2 - 1;"}]
    }
  ]
}
```

`before: null`は存在しないfileの追加。置換は正確に一か所へ一致しなければ失敗する。caseは個別コピーで実行する。原本は変更しない。baselineが成功した場合だけcaseを実行する。rejectはexit 1と固有診断の完全一致行が必要。timeout、signal、別exit、無関係な例外はERROR。acceptはexit 0が必要。suite全体が成功した場合だけexit 0。sourceとsuiteのSHA-256、各caseの結果と出力をJSON Linesで返す。

`.git`、`node_modules`、`.reference`、`.tmp`はコピーしない。依存は隔離環境に事前準備するか、信頼した外部executorの絶対pathをcommandに指定する。対象のsymlinkは拒否する。commandはshell文字列ではなくargv。suiteと検査器は評価対象の候補が勝手に変更できないrevisionから供給する。

コピーはOS sandboxではない。実行するコードはhost権限と環境変数を持つ。未知・敵対的なコードはcredentialのない隔離runtimeで実行する。子processや外部side effectの隔離はruntimeの責務。これを本ツールの保証と報告しない。

caseが拒否された事実は、そのcaseの拒否だけを示す。検査器の完全性、アンチケース集合の完全性、要求充足、最適性を示さない。改善候補には同じ要求検査を適用し、別途改善関係の証拠を確認する。
