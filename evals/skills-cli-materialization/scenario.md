# Skills CLI materialization eval

## What this evaluates

Whether a consumer project can materialize project-init Agent Skills with the
Skills CLI in a way that is **discoverable, reproducible and free of duplicate
tracking**, and whether a grader can tell a correct materialization from a
broken one.

The contract under evaluation is the one in Issue #98, not a model. That makes
this a **deterministic** eval rather than a latent one: the properties are
mechanically checkable, so putting them in an LLM judge would add noise
without adding signal. This is the `deterministic space` half of the
Constitution's split.

## Properties

| # | Property | Check |
|---|----------|-------|
| 1 | discovery | `skills add <source> --list` exits 0 and offers the requested skill |
| 2 | install | the skill lands under `.agents/skills/<name>/SKILL.md` |
| 3 | discovered | `skills list` reports it after install |
| 4 | frontmatter | `name` equals the directory, `description` is present and is a single scalar, and `skills list` reports **zero** `Skipped` entries |
| 5 | no global | the skill does not resolve under the user home |
| 6 | provenance | `skills-lock.json` carries `source`, `skillPath` and `computedHash`, with matching counts |
| 7 | no dup track | agent link directories (`.claude/skills`, `.codex/skills`) are gitignored |

Property 4 exists because of a real defect. A `description:` written as a bare
scalar containing `": "` is read by YAML as a nested mapping key, and the
Skills CLI then reports the skill as `Skipped` while the install itself
succeeds. `rebuildup/xyt-media` shipped four such skills. An install that
cannot be discovered is not a successful install.

Property 7 exists because the CLI materializes per-agent links. On Windows
those are junctions, and with `core.symlinks=false` git will happily track the
same canonical content a second time.

## Running

Offline, deterministic, no network:

```bash
bash evals/skills-cli-materialization/controls.sh
```

End-to-end against the real CLI and the real source. `bunx skills` when Bun is
available, `npx skills` otherwise; skips with a `SKIP` marker rather than a
false PASS when neither runtime exists:

```bash
bash evals/skills-cli-materialization/grade.sh --live engineering-decisions
```

Overridable: `SKILLS_SOURCE` (default `rebuildup/project-init`),
`SKILLS_CLI` (force a specific CLI invocation), `SKILLS_WORKDIR` (where the
throwaway project is created).

## Controls

`controls.sh` runs the grader over one positive fixture and seven fixtures
that must each be rejected for a named reason. A grader that accepts any of
the negatives makes the eval worthless as quality evidence, which is the same
rule CONTRIBUTING states for latent graders.

| Fixture | Expected | Property exercised |
|---|---|---|
| `positive` | PASS | all seven |
| `negative-name-mismatch` | FAIL | 4 |
| `negative-unquoted-colon` | FAIL | 4 |
| `negative-lock-no-hash` | FAIL | 6 |
| `negative-skipped-in-list` | FAIL | 3, 4 |
| `negative-untracked-agent-link` | FAIL | 7 |
| `negative-missing-reference` | FAIL | reference integrity |
| `regression-unquoted-triggers` | FAIL | 4, the xyt-media shape |

## Environment findings baked into the grader

Three things the grader has to get right, each of which was a live bug during
development:

- **ANSI.** The CLI emits SGR colour codes and wraps long lines, so
  `engineering-decisions` arrives as `ESC[36m…engineering…ESC[90m-decisions`.
  Text inspection runs on ANSI-stripped output.
- **CRLF.** Windows checkouts give `SKILL.md` CRLF endings. Without stripping
  `\r`, every file looks like it has no frontmatter delimiter.
- **UNC work directories.** Under Git-Bash-on-Windows, `mktemp -d` returns an
  MSYS path that resolves to `\\wsl.localhost\Ubuntu\tmp\…`. A Windows `npx`
  cannot write there, so the install silently no-ops and `list` reports "No
  project skills found" — which reads like a contract violation instead of an
  environment problem. The work directory is therefore created next to this
  script on a native path, and a UNC path is rejected up front.

## Known limits

- `--live` needs network access and a JS runtime. It is not part of the
  offline control set by design; `controls.sh` is the gate.
- The frontmatter check is intentionally not a full YAML parser. A full parser
  would accept shapes the Skills CLI rejects, which is the opposite of what
  this contract needs to catch.
- `--check` verifies the properties of a tree. It cannot tell whether the
  installed content still matches upstream; that is the update/reconcile
  concern, which Issue #98 tracks separately and this eval does not yet cover.