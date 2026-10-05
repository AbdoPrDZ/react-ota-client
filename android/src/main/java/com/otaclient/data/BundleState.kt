package com.otaclient.data

/** Which copy of the bundle is active, and where it lives. */
data class BundleState(
  val manifest: Manifest,
  /** `downloaded` for an OTA bundle, `embedded` for the copy inside the APK. */
  val source: String,
  /** Absolute path of the active bundle, `null` while the embedded copy runs. */
  val path: String?,
  /**
   * Absolute path of the directory holding the active bundle and its `fonts/` and
   * `assets/` folders, `null` while the embedded copy runs.
   *
   * JavaScript builds `file://` URIs from this to reach images that ship with the
   * bundle, so it must be the real staging directory rather than something
   * derived from [path] on the JS side.
   */
  val directory: String?,
) {
  companion object {
    const val SOURCE_DOWNLOADED = "downloaded"
    const val SOURCE_EMBEDDED = "embedded"
  }
}
