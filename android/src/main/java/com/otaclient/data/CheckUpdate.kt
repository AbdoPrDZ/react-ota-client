package com.otaclient.data

import java.io.File

/** Result of the update check. */
data class CheckUpdate(
  val haveUpdate: Boolean,
  val haveVersionUpdate: Boolean,
  val haveBundleUpdate: Boolean,
  val appInfo: AppInfo?,
)

/** A staged, verified bundle waiting to be activated. */
data class DownloadBundle(
  val downloadDir: File,
  val manifest: Manifest,
  val bundleFile: File,
  val manifestFile: File,
)
