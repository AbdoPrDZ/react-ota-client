package com.otaclient.ota

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Downloads a new APK inside the app and hands it to the system package
 * installer — no browser involved.
 *
 * The download uses [HttpURLConnection] rather than Android's DownloadManager:
 * DownloadManager runs in the system downloads process, which ignores this
 * app's `network_security_config` (plain-HTTP dev servers fail) and cannot
 * write to the app's private storage. The file is served to the installer
 * through [OtaApkFileProvider], so no `file://` URI crosses app boundaries.
 *
 * The system confirmation dialog itself cannot be skipped on modern Android,
 * and the app needs the "install unknown apps" capability: [canInstall] reports
 * it and [openInstallSettings] opens the toggle.
 */
object ApkInstaller {

  private const val TAG = "OtaClient"
  const val MIME = "application/vnd.android.package-archive"
  private const val DIRECTORY = "ota-apk"
  private const val MAX_REDIRECTS = 5
  private const val PROGRESS_INTERVAL_MS = 120L

  /** A failure with a stable code the JS layer can branch on. */
  class ApkInstallException(val code: String, message: String, cause: Throwable? = null) :
    Exception(message, cause)

  const val E_INSTALL_PERMISSION = "E_OTA_INSTALL_PERMISSION"
  const val E_HTTP = "E_OTA_APK_HTTP"
  const val E_NOT_APK = "E_OTA_NOT_APK"
  const val E_CHECKSUM = "E_OTA_APK_CHECKSUM"
  const val E_CANCELLED = "E_OTA_APK_CANCELLED"
  const val E_DOWNLOAD = "E_OTA_APK_DOWNLOAD"
  const val E_INSTALL = "E_OTA_APK_INSTALL"

  fun authority(context: Context): String = "${context.packageName}.otaclient.apkprovider"

  /** Whether the app may open the package installer ("install unknown apps"). */
  fun canInstall(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.packageManager.canRequestPackageInstalls()
    } else {
      true
    }

  /** Opens the system toggle for "install unknown apps"; `false` below Android 8. */
  fun openInstallSettings(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false

    val intent = Intent(
      Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
      Uri.parse("package:${context.packageName}"),
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    return try {
      context.startActivity(intent)
      true
    } catch (e: ActivityNotFoundException) {
      Log.w(TAG, "No settings screen for unknown app sources", e)
      false
    }
  }

  /**
   * Downloads the APK at [url] (blocking: call it off the main thread) and
   * returns the verified file.
   *
   * @param expectedSha256 hex SHA-256 from the server; verified when present.
   * @param cancelled set it to abort the download ([E_CANCELLED]).
   * @param onProgress `(received, total)`; `total` is `-1` when unknown.
   */
  fun download(
    context: Context,
    url: String,
    fileName: String,
    headers: Map<String, String> = emptyMap(),
    expectedSha256: String? = null,
    cancelled: AtomicBoolean = AtomicBoolean(false),
    onProgress: (received: Long, total: Long) -> Unit = { _, _ -> },
  ): File {
    val directory = directory(context)

    // Only the newest download is ever needed.
    directory.listFiles()?.forEach { it.delete() }

    val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_")
      .let { if (it.endsWith(".apk", ignoreCase = true)) it else "$it.apk" }
    val target = File(directory, safeName)
    val partial = File(directory, "$safeName.part")

    var connection: HttpURLConnection? = null

    try {
      connection = open(url, headers)
      val code = connection.responseCode

      if (code !in 200..299) {
        val body = runCatching { connection.errorStream?.bufferedReader()?.use { it.readText() } }.getOrNull()
        throw ApkInstallException(E_HTTP, body?.let(::serverMessage) ?: "The server answered HTTP $code.")
      }

      val total = connection.contentLengthLong
      val digest = MessageDigest.getInstance("SHA-256")
      var received = 0L
      var lastEmit = 0L

      connection.inputStream.use { input ->
        partial.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)

          while (true) {
            if (cancelled.get()) throw ApkInstallException(E_CANCELLED, "Download cancelled.")

            val read = input.read(buffer)
            if (read < 0) break

            output.write(buffer, 0, read)
            digest.update(buffer, 0, read)
            received += read

            val now = System.currentTimeMillis()
            if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
              lastEmit = now
              onProgress(received, total)
            }
          }
        }
      }

      onProgress(received, if (total > 0) total else received)

      if (!looksLikeApk(partial)) throw ApkInstallException(E_NOT_APK, "The server did not send an installable APK.")

      val actual = digest.digest().joinToString("") { "%02x".format(it) }
      if (!expectedSha256.isNullOrBlank() && !actual.equals(expectedSha256.trim(), ignoreCase = true)) {
        throw ApkInstallException(E_CHECKSUM, "The downloaded APK does not match the server's checksum.")
      }

      if (!partial.renameTo(target)) {
        partial.copyTo(target, overwrite = true)
        partial.delete()
      }

      return target
    } catch (e: ApkInstallException) {
      partial.delete()
      throw e
    } catch (e: Exception) {
      partial.delete()
      Log.w(TAG, "APK download failed: $url", e)
      throw ApkInstallException(E_DOWNLOAD, e.message ?: e.javaClass.simpleName, e)
    } finally {
      connection?.disconnect()
    }
  }

  /** Opens the system installer for [file]. Must run on the main thread. */
  fun launchInstaller(context: Context, file: File) {
    val uri = FileProvider.getUriForFile(context, authority(context), file)
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, MIME)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      throw ApkInstallException(E_INSTALL, e.message ?: "No package installer is available.", e)
    }
  }

  private fun directory(context: Context): File =
    File(context.getExternalFilesDir(null) ?: context.filesDir, DIRECTORY).apply { mkdirs() }

  /**
   * Follows redirects by hand: HttpURLConnection refuses protocol-changing ones
   * (http <-> https), which some reverse proxies issue. Credentials are only
   * re-sent to the original host.
   */
  private fun open(url: String, headers: Map<String, String>): HttpURLConnection {
    var current = URL(url)
    val origin = current.host

    repeat(MAX_REDIRECTS + 1) {
      val connection = (current.openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 15_000
        readTimeout = 60_000
        instanceFollowRedirects = false
        setRequestProperty("Accept", "$MIME, application/octet-stream, application/json;q=0.5")
        headers.forEach { (key, value) ->
          if (current.host == origin || !isCredential(key)) setRequestProperty(key, value)
        }
      }

      val code = connection.responseCode
      if (code !in 300..399) return connection

      val location = connection.getHeaderField("Location")
      connection.disconnect()
      if (location.isNullOrEmpty()) throw IllegalStateException("Redirect without a location.")
      current = URL(current, location)
    }

    throw IllegalStateException("Too many redirects.")
  }

  private fun isCredential(header: String): Boolean =
    header.equals("Authorization", true) || header.equals("API-KEY", true)

  private fun serverMessage(body: String): String? =
    runCatching { JSONObject(body).optString("message").takeIf { it.isNotBlank() } }.getOrNull()

  /** An APK is a zip: it starts with "PK". */
  private fun looksLikeApk(file: File): Boolean {
    if (!file.exists() || file.length() < 4) return false

    return runCatching {
      file.inputStream().use { stream ->
        val signature = ByteArray(2)
        stream.read(signature) == 2 && signature[0] == 0x50.toByte() && signature[1] == 0x4B.toByte()
      }
    }.getOrDefault(false)
  }
}
