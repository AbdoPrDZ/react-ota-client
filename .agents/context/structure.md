# Context Structure

The specification for this context: which files exist, what each holds, and when
new ones are created. Change this file only when the organization changes.

## Files

| File | Holds | Does not hold |
| --- | --- | --- |
| `README.md` | What the context is, what to read per task | Project knowledge |
| `config.md` | Update mode, detail level, scope, template | Anything else |
| `structure.md` | This specification | Project knowledge |
| `architecture.md` | What the package is, its parts (Kotlin engine, JS API and components, CLI), how they connect, repo layout | Endpoint details, commands |
| `server-api.md` | The contract with OTACenter: routes, headers, auth, response shapes the engine relies on | Server internals (OTACenter's own context) |
| `workflows.md` | Build, packaging, CLI usage, testing in a host app, releasing | Architecture rationale |
| `conventions.md` | Rules for changes: compatibility, what must stay in sync, style | Feature descriptions |
| `domains/README.md` | Index of domain files | Domain content |
| `domains/bundle-updates.md` | JS bundle updates: archive format, staging, swap, rollback, fonts and images | APK installs |
| `domains/native-updates.md` | New app versions: in-app APK download and install, fallbacks | Bundle updates |

## Creation rules

- A new domain file only for a feature with its own rules that spans layers
  (Kotlin + JS, or client + server), e.g. demo releases if the client gains
  device linking. Not one file per module.
- `decisions.md` once decisions pile up that the CHANGELOG doesn't explain.
- An `ios.md` only if the engine gains iOS support; today iOS is a no-op.

## Per detail level

```text
minimal:   README.md, config.md, structure.md, architecture.md
standard:  + server-api.md, workflows.md, conventions.md, domains/
detailed:  + decisions.md, deeper domain files (state machines, error tables)
```

## Related, outside this context

- `README.md` and `CHANGELOG.md` at the repo root: user guide and history.
- `E:\OTA\OTACenter\.agents\context\`: the server.
- `E:\OTA\exo-ota-client`: the Expo sibling (`expo-ota-client`), which uses
  expo-updates as its engine instead of this one.
- `E:\OTA\OTAStore`: an app that installs this package from GitHub.
