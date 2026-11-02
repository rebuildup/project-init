# Execution placement evidence

These redacted transcripts record validation of commit `9d880aa25919a22e982a7cbd2d1d4ee874938dc3` on 2026-11-02. They are historical evidence for that exact candidate, not automatic validation of later commits.

Mac: macOS 27.0.1 arm64, Node 26.13.0, Bun 1.4.4. `final-results.json` maps fourteen workflow commands to exit status; `9d880aa-mac-*.log` contains their output in the same order. Windows: Windows 11 build 29698, PowerShell 7.6.9, Node 24.19.0; eighteen targeted tests passed. WSL: Ubuntu 26.04.1, Node 26.13.0, Bun 1.4.4; fourteen workflow commands passed using installed runtime binaries instead of HOME-sensitive mise shims.

The Windows/WSL transcripts were collected through Herdr 0.9.5 API from dedicated Verify-147 tabs in existing default sessions. SHA-bearing ticks and completion markers demonstrate terminal process continuity across separate CLI connections. They do not demonstrate GUI interaction or TUI-client reconnection. Original user panes were preserved. The cold-eval answer and grade evaluate policy interpretation, not runtime enforcement.

User paths and account/host labels are redacted. Logs are selected terminal excerpts, not complete Windows/WSL process logs. No credential, endpoint registry, SSH key or login cache is included.

Policy/evaluation delivery can be reviewed independently from operational acceptance. Issue #147 remains the ongoing acceptance tracker for GUI/TUI interaction, normal Windows login/Infisical, resource arbitration, fault/fencing and Supervisor enforcement. WSL lifecycle acceptance remains with dotfiles #78. No autonomous scheduler or remote permission enforcement is claimed.
