package com.otaclient.utils

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.edit
import com.google.gson.Gson
import com.otaclient.data.DeviceInfo
import com.otaclient.data.Manifest
import com.otaclient.ota.OtaHost
import java.io.File

/**
 * Everything the engine persists between launches: server coordinates, the
 * active bundle bookkeeping, the device fingerprint and the current manifest.
 *
 * [init] is idempotent and is called lazily by the engine, so a host app only
 * has to call it from `MainApplication.onCreate()` if it wants a head start.
 */
object AppStorage {

  private const val TAG = "OtaClient"
  private const val PREF_NAME = "ota_client_prefs"

  private const val KEY_API_BASE_URL = "api_base_url"
  private const val KEY_API_VERSION = "api_version"
  private const val KEY_API_KEY = "api_key"
  private const val KEY_RUNNING_BUNDLE_DIR = "running_bundle_dir"
  private const val KEY_LAST_GOOD_BUNDLE_DIR = "last_good_bundle_dir"
  private const val KEY_PENDING_PID = "pending_pid"
  private const val KEY_DEVICE_INFO = "device_info"

  /** File name of the manifest, both in the OTA archive and in the APK assets. */
  const val MANIFEST_FILE = "manifest.json"

  /** Bundle name used when the host has no `manifest.json` in its assets. */
  const val DEFAULT_BUNDLE_NAME = "index.android.bundle"

  @Volatile
  private var preferences: SharedPreferences? = null

  @Volatile
  private var applicationContext: Context? = null

  @Volatile
  private var baseManifest: Manifest? = null

  @Volatile
  private var activeManifest: Manifest? = null

  @Volatile
  private var deviceInfo: DeviceInfo? = null

  val isInitialized: Boolean
    get() = preferences != null

  @Synchronized
  fun init(context: Context) {
    val app = context.applicationContext
    applicationContext = app

    if (preferences == null) {
      preferences = app.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    }

    if (deviceInfo == null) {
      deviceInfo = readDeviceInfo(app)
    }

    loadManifest(app)
  }

  fun requireContext(): Context =
    applicationContext ?: error("AppStorage.init(context) must be called before using the engine")

  private fun prefs(): SharedPreferences =
    preferences ?: error("AppStorage.init(context) must be called before using the engine")

  private fun readString(key: String): String? = preferences?.getString(key, null)

  // ---------------------------------------------------------------- server config

  var API_BASE_URL: String
    get() = readString(KEY_API_BASE_URL).orEmpty()
    set(value) = prefs().edit(commit = true) { putString(KEY_API_BASE_URL, value.trim()) }

  var API_VERSION: String
    get() = readString(KEY_API_VERSION).orEmpty()
    set(value) = prefs().edit(commit = true) { putString(KEY_API_VERSION, value.trim()) }

  var API_KEY: String
    get() = readString(KEY_API_KEY).orEmpty()
    set(value) = prefs().edit(commit = true) { putString(KEY_API_KEY, value.trim()) }

  /** Wipes the stored server coordinates so manifest meta-data applies again. */
  fun clearConfig() {
    prefs().edit(commit = true) {
      remove(KEY_API_BASE_URL)
      remove(KEY_API_VERSION)
      remove(KEY_API_KEY)
    }
  }

  // ---------------------------------------------------------------- bundle bookkeeping

  /** Directory of the OTA bundle in use, `null` when the embedded copy runs. */
  var RUNNING_BUNDLE_DIR: File?
    get() = readString(KEY_RUNNING_BUNDLE_DIR)?.let { File(it) }?.takeIf { it.isDirectory }
    set(value) = prefs().edit(commit = true) {
      putString(KEY_RUNNING_BUNDLE_DIR, value?.absolutePath)
    }

  /** The previous bundle, restored automatically if the current one fails to boot. */
  var LAST_GOOD_BUNDLE_DIR: File?
    get() = readString(KEY_LAST_GOOD_BUNDLE_DIR)?.let { File(it) }?.takeIf { it.isDirectory }
    set(value) = prefs().edit(commit = true) {
      putString(KEY_LAST_GOOD_BUNDLE_DIR, value?.absolutePath)
    }

  /**
   * PID of the process that started the current bundle without confirming it yet.
   * A different value on the next start means that process died, so the bundle is
   * rolled back. `0` means "confirmed good".
   */
  var PENDING_PID: Int
    get() = preferences?.getInt(KEY_PENDING_PID, 0) ?: 0
    set(value) = prefs().edit(commit = true) { putInt(KEY_PENDING_PID, value) }

  /** Forgets the active bundle, sending the next start back to the APK copy. */
  fun clearRunningBundle() {
    prefs().edit(commit = true) {
      remove(KEY_RUNNING_BUNDLE_DIR)
      remove(KEY_PENDING_PID)
    }

    applicationContext?.let { loadManifest(it) }
  }

  fun clearAll() {
    prefs().edit(commit = true) { clear() }
    baseManifest = null
    activeManifest = null
    applicationContext?.let { loadManifest(it) }
  }

  // ---------------------------------------------------------------- manifests

  /** Manifest of the active bundle, falling back to the one embedded in the APK. */
  val MANIFEST: Manifest
    get() = activeManifest ?: baseManifest ?: fallbackManifest()

  /**
   * Reads the base manifest from the host app's `assets/manifest.json` and the
   * active one from the staging directory, if any.
   */
  @Synchronized
  fun loadManifest(context: Context) {
    val app = context.applicationContext

    if (baseManifest == null) {
      baseManifest = try {
        app.assets.open(MANIFEST_FILE).bufferedReader().use { reader ->
          Gson().fromJson(reader, Manifest::class.java)
        }
      } catch (e: Exception) {
        Log.w(TAG, "No usable $MANIFEST_FILE in the APK assets, falling back to package info", e)
        null
      }
    }

    val directory = RUNNING_BUNDLE_DIR
    activeManifest = if (directory == null) null else readManifest(File(directory, MANIFEST_FILE))
  }

  /** Parses a manifest file, returning `null` when it is missing or malformed. */
  fun readManifest(file: File): Manifest? {
    if (!file.isFile) {
      return null
    }

    return try {
      file.bufferedReader().use { reader -> Gson().fromJson(reader, Manifest::class.java) }
    } catch (e: Exception) {
      Log.e(TAG, "Malformed manifest at ${file.absolutePath}", e)
      null
    }
  }

  private fun fallbackManifest(): Manifest {
    val version = applicationContext?.let { OtaHost.versionName(it) }.orEmpty()

    return Manifest(
      version = version,
      runtimeVersion = version,
      bundle = DEFAULT_BUNDLE_NAME,
      checksum = null,
      size = null,
      createdAt = null,
    )
  }

  // ---------------------------------------------------------------- device

  /** Device fingerprint, computed once per install. */
  fun deviceInfo(context: Context): DeviceInfo {
    deviceInfo?.let { return it }

    val info = readDeviceInfo(context.applicationContext)
    deviceInfo = info

    preferences?.edit(commit = true) { putString(KEY_DEVICE_INFO, Gson().toJson(info)) }

    return info
  }

  @SuppressLint("HardwareIds")
  private fun readDeviceInfo(context: Context): DeviceInfo {
    val cached = preferences?.getString(KEY_DEVICE_INFO, null)

    if (cached != null) {
      try {
        return Gson().fromJson(cached, DeviceInfo::class.java)
      } catch (e: Exception) {
        Log.w(TAG, "Dropping malformed cached device info", e)
      }
    }

    return DeviceInfo(
      androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID),
      manufacturer = Build.MANUFACTURER.orEmpty(),
      brand = Build.BRAND.orEmpty(),
      model = Build.MODEL.orEmpty(),
      androidVersion = Build.VERSION.RELEASE.orEmpty(),
      sdkVersion = Build.VERSION.SDK_INT,
      supportedAbis = Build.SUPPORTED_ABIS?.toList().orEmpty(),
    )
  }
}
