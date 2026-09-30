package com.otaclient.data

/** Which copy of the bundle is active, and where it lives. */
data class BundleState(
  val manifest: Manifest,
  /** `downloaded` for an OTA bundle, `embedded` for the copy inside the APK. */
  val source: String,
  /** Absolute path of the active bundle, `null` while the embedded copy runs. */
  val path: String?,
) {
  companion object {
    const val SOURCE_DOWNLOADED = "downloaded"
    const val SOURCE_EMBEDDED = "embedded"
  }
}
