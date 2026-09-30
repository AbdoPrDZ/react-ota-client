package com.otaclient.data

/** Common envelope every OTA endpoint responds with. */
data class APIResponse<T>(
  val success: Boolean,
  val message: String? = null,
  val data: T? = null,
)

/** An update the server offers, identified by the id used in download URLs. */
data class UpdateInfo(
  val id: String,
  val name: String,
)

/** The two kinds of update the engine understands. */
data class AppInfoAvailableUpdates(
  /** A new APK is available. */
  val version: UpdateInfo? = null,
  /** A new JS bundle is available. */
  val bundle: UpdateInfo? = null,
)

/** Server's view of this installation. */
data class AppInfo(
  val appId: String,
  val versionId: String,
  val bundleId: String,
  val availableUpdates: AppInfoAvailableUpdates = AppInfoAvailableUpdates(),
  /** Short-lived token required to download bundles. */
  val session: String,
)
