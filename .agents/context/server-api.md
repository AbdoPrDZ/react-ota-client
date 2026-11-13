# OTACenter Contract

What the engine expects from OTACenter (`E:\OTA\OTACenter`,
`routes/ota_client.php`, `OTAClient/AppController`). A change on either side
must be made on both. The same device API serves `expo-ota-client`.

Base: `{apiBaseUrl}/ota-client/{apiVersion}` (`apiVersion` defaults to `v1`).

## Headers

Every request: `API-KEY` (per OTACenter version) and
`X-Device-Info: did=…;mf=…;br=…;mdl=…;av=…;sdv=…` (`did` is the Android ID).
Responses use the envelope `{ success, message, data }`.

## Routes

| Route | Used for |
| --- | --- |
| `GET /health` | `healthCheck()` |
| `POST /app/info` | `checkUpdate()`: body `package`, `version` (APK `versionName`), `bundle` (active manifest version). Returns `availableUpdates.bundle` / `availableUpdates.version` (with `updateType`, `checksum`, `demo`) and a `session` token |
| `GET /app/update/bundle/{id}` | Bundle archive, `Authorization: Bearer {session}`. `Content-Length` gives a determinate progress bar |
| `GET /app/update/version/{id}?did=&token=&api_key=` | APK. Query auth, so the same link works in a browser |
| `POST /app/event` | Activity reports (form-encoded, fire-and-forget) |

## Server-side rules the client relies on

- The version is looked up by name = runtime version; the API key must be that
  version's key.
- Demo releases: the server only offers demos to devices whose linked user is in
  an `allow_demo` domain; the client just shows `demo: true`. This client has no
  device-linking API yet (`expo-ota-client` has `/device/link`).
- `checksum` on a version is the APK's SHA-256; the installer refuses a mismatch.
