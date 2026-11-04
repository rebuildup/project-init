# Open Code Review — OpenCode Go / MiMo

`pc-setup` installs the `ocr` binary (official GitHub Release via mise). `dotfiles` owns only the user configuration and the credential bridge.

- Config: `home/.opencodereview/config.json` → `~/.opencodereview/config.json` via `script/link` (POSIX) or `script/link.ps1 -Apply` (Windows).
- Provider: custom `opencode-go`, protocol `openai`, base URL `https://opencode.ai/inference/go/v1`, model `mimo-v2.6-flash` (OpenAI-compatible chat completions).
- Session: `extra_headers` sends `x-opencode-session: {ocr_session_key}`. OpenCode Go rejects any request without that header (HTTP 400 `MissingSessionID`); OCR expands the template to a stable per-conversation key, falling back to a generated key for session-less calls such as `ocr llm test`.
- Credential: `api_key_cmd = "ocr-go-key"`, resolved by OCR's shell from `PATH`. POSIX and Windows launchers in `home/.local/bin/` run `script/ocr-go-key.ts` with Bun. That script strips an ambient `OPENCODE_API_KEY`, then invokes the existing self-hosted Infisical `script/with-secrets` / `script/with-secrets.ps1` boundary and prints only the freshly injected key. No secret value is stored in Git or OCR config.

## Apply and verify

Make sure `~/.local/bin` is on `PATH`, Bun and Infisical are installed by `pc-setup`, and the Infisical login/project binding works.

On macOS / WSL / Linux:

```sh
cd ~/.dotfiles
./script/link
./script/check
ocr llm test
```

On Windows native (PowerShell):

```powershell
cd ~/.dotfiles
pwsh -NoProfile -File script/link.ps1          # review the plan
pwsh -NoProfile -File script/link.ps1 -Apply   # only links absent targets
ocr llm test
```

The managed config is an ordinary file in Git and a symlink at the live path; do not run `ocr config set ...api_key` or paste a key in the TUI. That would write plaintext into a tracked file. For settings changes, modify the Git source and review its diff. The key command intentionally emits a secret to stdout **when called**; never print or capture its output in logs. Only use `ocr llm test` to verify connectivity.

If an existing `~/.opencodereview/config.json` conflicts, the linking scripts fail/report a conflict instead of overwriting it. Back it up outside the repository and manually migrate desired non-secret settings before linking. OCR sessions and other files within `~/.opencodereview/` remain untouched.

OpenCode Go and Zen may share an `OPENCODE_API_KEY`, but only this `/inference/go/v1` endpoint is configured. Keep Extra Usage disabled in the OpenCode console if you need to prevent pay-as-you-go overflow; the endpoint alone cannot enforce billing controls. Missing/invalid credentials fail closed; no fallback model or provider is configured.

References: https://github.com/alibaba/open-code-review/blob/main/pages/src/content/docs/en/configuration.md and https://opencode.ai/docs/go/
