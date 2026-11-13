# Project Context

AI-readable memory for `ota-client` (repo `react-ota-client`): the smallest set
of facts an agent needs before changing this repo. It is derived knowledge; when
it disagrees with the code, trust the code and fix the context.

Read order: this file → `config.md` → `structure.md` → the files for your task.

## What to read

| Task | Read |
| --- | --- |
| Anything, first time | `architecture.md` |
| Bundle download, swap, rollback, fonts/images | `domains/bundle-updates.md` |
| New APK installs | `domains/native-updates.md` |
| Requests to OTACenter | `server-api.md` |
| JS API, provider, overlay | `architecture.md`, `conventions.md` |
| Build, CLI, packaging, testing in an app | `workflows.md` |

## Files

- `architecture.md`: the engine, the JS layer, the CLI, and how they connect.
- `server-api.md`: the OTACenter contract.
- `workflows.md`: build, packaging, CLI, testing, release.
- `conventions.md`: rules for changes.
- `domains/`: bundle updates, native updates.
