package com.otaclient.ota

import androidx.core.content.FileProvider

/**
 * Serves downloaded APKs to the package installer.
 *
 * A subclass (not `androidx.core.content.FileProvider` itself) so the manifest
 * entry cannot collide with a FileProvider the host app declares.
 */
class OtaApkFileProvider : FileProvider()
