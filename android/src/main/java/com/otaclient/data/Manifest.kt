package com.otaclient.data

/**
 * The `manifest.json` that travels inside every OTA archive and is written next
 * to the bundle embedded in the APK.
 *
 * `checksum` / `size` were added after the first manifest format shipped, so
 * they stay optional; Gson leaves them `null` for old files.
 */
data class Manifest(
  /** Bundle version published to the server. */
  val version: String,
  /** Native runtime compatibility key; must equal the host APK `versionName`. */
  val runtimeVersion: String,
  /** File name of the bundle inside the archive. */
  val bundle: String,
  /** MD5 of the bundle, verified after extraction. */
  val checksum: String? = null,
  /** Byte size of the bundle, verified after extraction. */
  val size: Long? = null,
  val createdAt: String? = null,
) {
  /** `{runtimeVersion}-{version}`, the name of the staging directory. */
  val directoryName: String
    get() = "$runtimeVersion-$version"
}
