package com.otaclient.ota

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log

/** Immutable snapshot of the server coordinates the engine will use. */
data class OtaServerConfig(
  val apiBaseUrl: String,
  val apiVersion: String,
  val apiKey: String,
) {
  /** `true` once an API base URL is known. */
  val isConfigured: Boolean
    get() = apiBaseUrl.isNotBlank()

  /** `{apiBaseUrl}/ota-client/{apiVersion}` — the root of every endpoint. */
  val apiRootUrl: String
    get() = "${apiBaseUrl.trimEnd('/')}/ota-client/${apiVersion.trim('/')}"
}

/**
 * Manifest meta-data keys and the small amount of policy the engine reads from
 * the host app.
 *
 * ```xml
 * <application>
 *   <meta-data android:name="ota_client_api_base_url" android:value="https://updates.example.com" />
 *   <meta-data android:name="ota_client_api_version" android:value="v1" />
 *   <meta-data android:name="ota_client_api_key"    android:value="v1.xxxxxxxxxxxxxx" />
 *   <meta-data android:name="ota_client_main_activity" android:value="com.myapp.MainActivity" />
 * </application>
 * ```
 *
 * Every value can also be set at runtime with `OtaClient.configure()`; the
 * runtime value wins, which keeps the meta-data a safe default to commit.
 */
object OtaConfig {

  private const val TAG = "OtaClient"

  /** Scheme + host of the OTA server, e.g. `https://updates.example.com`. */
  const val META_API_BASE_URL = "ota_client_api_base_url"

  /** API prefix, e.g. `v1`. */
  const val META_API_VERSION = "ota_client_api_version"

  /** Value sent as the `API-KEY` header. */
  const val META_API_KEY = "ota_client_api_key"

  /** Fully qualified class name of the host's React Native activity. */
  const val META_MAIN_ACTIVITY = "ota_client_main_activity"

  /** Master switch: `false` disables the engine entirely. Default `true`. */
  const val META_ENABLED = "ota_client_enabled"

  /** Load downloaded bundles in debuggable builds too. Default `false`. */
  const val META_ALLOW_IN_DEBUG = "ota_client_allow_in_debug"

  /** Run the check on the native splash screen before React Native boots. Default `true`. */
  const val META_AUTO_CHECK = "ota_client_auto_check"

  /** Send the user to the configure screen when the server is unreachable. Default `true`. */
  const val META_SHOW_CONFIGURE = "ota_client_show_configure"

  /** Verify the MD5/size from `manifest.json` after extracting a bundle. Default `true`. */
  const val META_VERIFY_CHECKSUM = "ota_client_verify_checksum"

  /** Keeps this many staging directories around. Default `2`. */
  const val META_KEEP_BUNDLES = "ota_client_keep_bundles"

  /** Server coordinates, runtime overrides first, then manifest meta-data. */
  fun serverConfig(context: Context, stored: OtaServerConfig?): OtaServerConfig = OtaServerConfig(
    apiBaseUrl = stored?.apiBaseUrl?.takeIf { it.isNotBlank() }
      ?: OtaHost.metaString(context, META_API_BASE_URL, "").orEmpty(),
    apiVersion = stored?.apiVersion?.takeIf { it.isNotBlank() }
      ?: OtaHost.metaString(context, META_API_VERSION, DEFAULT_API_VERSION).orEmpty(),
    apiKey = stored?.apiKey?.takeIf { it.isNotBlank() }
      ?: OtaHost.metaString(context, META_API_KEY, "").orEmpty(),
  )

  /** `true` when the engine should take over `getJSBundleFile()`. */
  fun isEnabled(context: Context): Boolean {
    if (!OtaHost.metaBoolean(context, META_ENABLED, true)) {
      return false
    }

    return OtaHost.metaBoolean(context, META_ALLOW_IN_DEBUG, false) || !OtaHost.isDebuggable(context)
  }

  fun verifyChecksum(context: Context): Boolean =
    OtaHost.metaBoolean(context, META_VERIFY_CHECKSUM, true)

  fun keepBundles(context: Context): Int {
    val raw = applicationMetaInt(context, META_KEEP_BUNDLES)
    return if (raw != null && raw > 0) raw else DEFAULT_KEEP_BUNDLES
  }

  fun autoCheck(context: Context): Boolean = OtaHost.metaBoolean(context, META_AUTO_CHECK, true)

  fun showConfigure(context: Context): Boolean =
    OtaHost.metaBoolean(context, META_SHOW_CONFIGURE, true)

  @Suppress("DEPRECATION") // Bundle.get() is the only accessor that covers every meta-data type.
  private fun applicationMetaInt(context: Context, key: String): Int? =
    when (val value = OtaHost.applicationMetaData(context)?.get(key)) {
      is Int -> value
      is String -> value.toIntOrNull()
      is Float -> value.toInt()
      else -> null
    }

  /**
   * Relaunches the host's React Native activity and kills the current process so
   * the next start picks up a different `getJSBundleFile()` result.
   */
  fun restart(context: Context) {
    val intent: Intent = OtaHost.mainActivityIntent(context) ?: run {
      val fallback = context.packageManager.getLaunchIntentForPackage(context.packageName)

      if (fallback == null) {
        Log.e(TAG, "Cannot restart: no launcher or main activity found")
        return
      }

      fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    }

    context.startActivity(intent)

    // Give the new task a moment to start before the process disappears.
    android.os.Handler(context.mainLooper).postDelayed({ killProcess() }, RESTART_DELAY_MS)
  }

  /** Immediate variant used by `restartApp()` from JS. */
  fun restartNow(context: Context) {
    val intent = OtaHost.mainActivityIntent(context)
      ?: context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      }

    if (intent != null) {
      context.startActivity(intent)
    }

    killProcess()
  }

  /**
   * Opens an APK download URL with `ACTION_VIEW`, which hands off to the
   * browser or the package installer.
   */
  fun openDownloadUrl(context: Context, url: String): Boolean {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    return try {
      context.startActivity(intent)
      true
    } catch (e: Exception) {
      Log.e(TAG, "No handler for $url", e)
      false
    }
  }

  private fun killProcess() {
    android.os.Process.killProcess(android.os.Process.myPid())
    kotlin.system.exitProcess(0)
  }

  const val DEFAULT_API_VERSION = "v1"
  const val DEFAULT_KEEP_BUNDLES = 2
  private const val RESTART_DELAY_MS = 400L
}
