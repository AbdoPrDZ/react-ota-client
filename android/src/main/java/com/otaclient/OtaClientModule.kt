package com.otaclient

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.otaclient.data.BundleState
import com.otaclient.data.CheckUpdate
import com.otaclient.data.DownloadBundle
import com.otaclient.data.Manifest
import com.otaclient.data.UpdateInfo
import com.otaclient.ota.OtaBundleProvider
import com.otaclient.ota.OtaConfig
import com.otaclient.ota.OtaHost
import com.otaclient.ota.OtaServerConfig
import com.otaclient.ota.OtaSwapException
import com.otaclient.utils.AppStorage
import com.otaclient.utils.OTAClient
import com.otaclient.utils.OtaException
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The JavaScript-facing engine, exposed as `NativeModules.OtaClient`.
 *
 * Every method is main-safe: the blocking work happens on [scope] and the promise
 * is resolved back on whatever thread the bridge expects. Failures reject with a
 * stable `code` so the JS layer can branch without string matching.
 */
@ReactModule(name = OtaClientModule.NAME)
class OtaClientModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "OtaClient"

    /** `{ downloaded, total, percent }` while a bundle is downloading. */
    const val EVENT_PROGRESS = "otaClient:downloadProgress"

    /** `{ code, message }` for failures with no owning promise. */
    const val EVENT_ERROR = "otaClient:error"

    private const val TAG = "OtaClient"
    private const val RESTART_DELAY_MS = 350L
    private const val PROGRESS_STEP_BYTES = 64L * 1024L
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Bundle staged by the last successful `downloadBundle()`, awaiting activation. */
  @Volatile
  private var staged: DownloadBundle? = null

  /** Progress throttling state, so a fast download does not flood the bridge. */
  @Volatile
  private var lastPercent: Int = -1

  @Volatile
  private var lastUnknownProgress: Long = 0L

  private val appContext: Context
    get() = reactApplicationContext.applicationContext

  init {
    AppStorage.init(appContext)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    scope.cancel()
    super.invalidate()
  }

  // ------------------------------------------------------------------ state

  @ReactMethod
  fun getState(promise: Promise) {
    runCatching { buildState(appContext) }
      .onSuccess { promise.resolve(it) }
      .onFailure { promise.reject(E_STATE, it.message, it) }
  }

  @ReactMethod
  fun getConfig(promise: Promise) {
    promise.resolve(serverConfigMap(serverConfig()))
  }

  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    promise.resolve(deviceInfoMap())
  }

  @ReactMethod
  fun configure(config: ReadableMap?, promise: Promise) {
    runCatching {
      AppStorage.init(appContext)

      if (config != null) {
        configString(config, "apiBaseUrl")?.let { AppStorage.API_BASE_URL = it }
        configString(config, "apiVersion")?.let { AppStorage.API_VERSION = it }
        configString(config, "apiKey")?.let { AppStorage.API_KEY = it }
      }

      serverConfig()
    }
      .onSuccess { promise.resolve(serverConfigMap(it)) }
      .onFailure { promise.reject(E_CONFIG, it.message, it) }
  }

  // ------------------------------------------------------------------ network

  @ReactMethod
  fun healthCheck(promise: Promise) {
    scope.launch {
      try {
        promise.resolve(engine().healthCheck())
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        promise.reject(E_HEALTH, e.message, e)
      }
    }
  }

  @ReactMethod
  fun checkUpdate(promise: Promise) {
    scope.launch {
      try {
        promise.resolve(checkUpdateMap(engine().checkUpdate()))
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        promise.reject(E_CHECK, e.message, e)
      }
    }
  }

  @ReactMethod
  fun downloadBundle(options: ReadableMap?, promise: Promise) {
    scope.launch {
      try {
        val updateId = options?.let { configString(it, "updateId") }
        val session = options?.let { configString(it, "session") }
        val check = resolveCheck(updateId, session)

        val result = engine().downloadBundle(check) { downloaded, total ->
          emitProgress(downloaded, total)
        }

        staged = result

        promise.resolve(
          Arguments.createMap().apply {
            putString("downloadDir", result.downloadDir.absolutePath)
            putMap("manifest", manifestMap(result.manifest))
            putString("fileName", result.bundleFile.name)
            putDouble("size", result.bundleFile.length().toDouble())
            putString("checksum", result.manifest.checksum)
          },
        )
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        promise.reject(errorCode(e), e.message, e)
      }
    }
  }

  @ReactMethod
  fun getAppUpdateUrl(promise: Promise) {
    runCatching { engine().appUpdateUrl() }
      .onSuccess { promise.resolve(it) }
      .onFailure { promise.reject(E_NO_VERSION_UPDATE, it.message, it) }
  }

  @ReactMethod
  fun openAppUpdate(url: String?, promise: Promise) {
    val target = url?.takeIf { it.isNotBlank() }
      ?: runCatching { engine().appUpdateUrl() }.getOrElse {
        promise.reject(E_NO_VERSION_UPDATE, it.message, it)
        return
      }

    promise.resolve(OtaConfig.openDownloadUrl(appContext, target))
  }

  // ------------------------------------------------------------------ bundles

  @ReactMethod
  fun activateBundle(directory: String?, promise: Promise) {
    runCatching {
      OtaBundleProvider.activate(appContext, directory?.let { File(it) })
    }
      .onSuccess { promise.resolve(bundleMap(it)) }
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun installBundle(directory: String?, promise: Promise) {
    runCatching {
      val target = resolveInstallTarget(directory)

      if (target != null) {
        OtaBundleProvider.activate(appContext, target)
      }

      OtaConfig.restart(appContext)
    }
      .onSuccess {
        // The process is about to be replaced; resolve first so JS can settle.
        promise.resolve(null)
      }
      .onFailure { promise.reject(errorCode(it), it.message, it) }
  }

  @ReactMethod
  fun markLaunchSucceeded(promise: Promise) {
    runCatching { OtaBundleProvider.markLaunchSucceeded(appContext) }
      .onSuccess { promise.resolve(null) }
      .onFailure { promise.reject(E_STATE, it.message, it) }
  }

  @ReactMethod
  fun revertToEmbeddedBundle(promise: Promise) {
    runCatching { OtaBundleProvider.revertToEmbedded(appContext) }
      .onSuccess { promise.resolve(it) }
      .onFailure { promise.reject(E_STATE, it.message, it) }
  }

  @ReactMethod
  fun cleanupOldBundles(keep: Int?, promise: Promise) {
    val limit = keep ?: OtaConfig.keepBundles(appContext)

    runCatching { OtaBundleProvider.cleanup(appContext, limit) }
      .onSuccess { promise.resolve(it) }
      .onFailure { promise.reject(E_STATE, it.message, it) }
  }

  @ReactMethod
  fun restartApp(promise: Promise) {
    promise.resolve(null)
    mainHandler.postDelayed({ OtaConfig.restartNow(appContext) }, RESTART_DELAY_MS)
  }

  // ------------------------------------------------------------------ events

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by NativeEventEmitter; the emitter itself is managed on the JS side.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required by NativeEventEmitter.
  }

  // ------------------------------------------------------------------ helpers

  private fun engine(): OTAClient = OTAClient.instance(appContext)

  private fun serverConfig(): OtaServerConfig = OtaConfig.serverConfig(
    appContext,
    OtaServerConfig(
      apiBaseUrl = AppStorage.API_BASE_URL,
      apiVersion = AppStorage.API_VERSION,
      apiKey = AppStorage.API_KEY,
    ),
  )

  /**
   * `updateId`/`session` let a caller download a bundle the cached check did not
   * describe; without them the last check is reused.
   */
  private suspend fun resolveCheck(updateId: String?, session: String?): CheckUpdate {
    val cached = engine().lastCheck

    if (updateId.isNullOrBlank()) {
      return cached ?: engine().checkUpdate()
    }

    val info = cached?.appInfo
      ?: throw OtaException("No session available: call checkUpdate() first")

    val token = session?.takeIf { it.isNotBlank() } ?: info.session
    val bundle = UpdateInfo(id = updateId, name = updateId)
    val updated = info.copy(availableUpdates = info.availableUpdates.copy(bundle = bundle), session = token)

    return CheckUpdate(
      haveUpdate = true,
      haveVersionUpdate = updated.availableUpdates.version != null,
      haveBundleUpdate = true,
      appInfo = updated,
    )
  }

  private fun resolveInstallTarget(directory: String?): File? {
    if (!directory.isNullOrBlank()) {
      return File(directory)
    }

    return staged?.downloadDir
      ?: stagedFromRunningDir()
      ?: throw OtaException("Nothing to install: call downloadBundle() first")
  }

  /** A bundle activated without going through `downloadBundle()` in this session. */
  private fun stagedFromRunningDir(): File? {
    val running = AppStorage.RUNNING_BUNDLE_DIR ?: return null
    val isStaged = staged?.downloadDir?.absolutePath == running.absolutePath

    return if (isStaged) running else null
  }

  private fun emitProgress(downloaded: Long, total: Long?) {
    if (!reactApplicationContext.hasActiveReactInstance()) {
      return
    }

    val percent = if (total != null && total > 0) {
      ((downloaded * 100) / total).toInt().coerceIn(0, 100)
    } else {
      null
    }

    // One event per whole percent, or every 64 KiB when the size is unknown.
    if (percent != null) {
      if (percent == lastPercent) {
        return
      }

      lastPercent = percent
    } else {
      if (downloaded - lastUnknownProgress < PROGRESS_STEP_BYTES) {
        return
      }

      lastUnknownProgress = downloaded
    }

    val payload = Arguments.createMap().apply {
      putDouble("downloaded", downloaded.toDouble())
      if (total != null) {
        putDouble("total", total.toDouble())
      } else {
        putNull("total")
      }
      if (percent != null) {
        putInt("percent", percent)
      } else {
        putNull("percent")
      }
    }

    reactApplicationContext.emitDeviceEvent(EVENT_PROGRESS, payload)
  }

  private fun buildState(context: Context): WritableMap {
    AppStorage.init(context)

    val bundle = OtaBundleProvider.currentState(context)
    val config = serverConfig()
    val hostVersion = OtaHost.versionName(context)

    return Arguments.createMap().apply {
      putString("platform", "android")
      putString("libraryVersion", OtaHost.libraryVersion)
      putBoolean("configured", config.isConfigured)
      putMap("config", serverConfigMap(config))
      putMap("deviceInfo", deviceInfoMap())
      putMap(
        "app",
        Arguments.createMap().apply {
          putString("packageName", OtaHost.packageName(context))
          putString("versionName", hostVersion)
          putDouble("versionCode", OtaHost.versionCode(context).toDouble())
        },
      )
      putMap("bundle", bundleMap(bundle))
      putBoolean("runtimeCompatible", bundle.manifest.runtimeVersion == hostVersion)
      putBoolean("pendingLaunch", OtaBundleProvider.isLaunchPending(context))
      putBoolean("usingDevServer", OtaBundleProvider.isUsingDevServer(context))
    }
  }

  private fun serverConfigMap(config: OtaServerConfig): WritableMap = Arguments.createMap().apply {
    putString("apiBaseUrl", config.apiBaseUrl)
    putString("apiVersion", config.apiVersion)
    putString("apiKey", config.apiKey)
  }

  private fun deviceInfoMap(): WritableMap {
    val info = AppStorage.deviceInfo(appContext)

    return Arguments.createMap().apply {
      putString("androidId", info.androidId)
      putString("manufacturer", info.manufacturer)
      putString("brand", info.brand)
      putString("model", info.model)
      putString("androidVersion", info.androidVersion)
      putInt("sdkVersion", info.sdkVersion)
      putArray("supportedAbis", Arguments.fromList(info.supportedAbis))
    }
  }

  private fun bundleMap(state: BundleState): WritableMap = Arguments.createMap().apply {
    putMap("manifest", manifestMap(state.manifest))
    putString("source", state.source)
    if (state.path != null) {
      putString("path", state.path)
    } else {
      putNull("path")
    }
  }

  private fun manifestMap(manifest: Manifest): WritableMap =
    Arguments.createMap().apply {
      putString("version", manifest.version)
      putString("runtimeVersion", manifest.runtimeVersion)
      putString("bundle", manifest.bundle)
      putString("checksum", manifest.checksum)
      if (manifest.size != null) {
        putDouble("size", manifest.size.toDouble())
      } else {
        putNull("size")
      }
      putString("createdAt", manifest.createdAt)
    }

  private fun checkUpdateMap(check: CheckUpdate): WritableMap = Arguments.createMap().apply {
    putBoolean("haveUpdate", check.haveUpdate)
    putBoolean("haveVersionUpdate", check.haveVersionUpdate)
    putBoolean("haveBundleUpdate", check.haveBundleUpdate)
    putMap("appInfo", check.appInfo?.let { info -> Arguments.createMap().apply {
      putString("appId", info.appId)
      putString("versionId", info.versionId)
      putString("bundleId", info.bundleId)
      putString("session", info.session)
      putMap("availableUpdates", Arguments.createMap().apply {
        putMap("version", info.availableUpdates.version?.let { updateMap(it.id, it.name) })
        putMap("bundle", info.availableUpdates.bundle?.let { updateMap(it.id, it.name) })
      })
    } })
  }

  private fun updateMap(id: String, name: String): WritableMap = Arguments.createMap().apply {
    putString("id", id)
    putString("name", name)
  }

  private fun configString(map: ReadableMap, key: String): String? {
    if (!map.hasKey(key) || map.isNull(key)) {
      return null
    }

    return map.getString(key)?.trim()?.takeIf { it.isNotEmpty() }
  }

  private fun errorCode(error: Throwable): String = when (error) {
    is OtaSwapException -> E_SWAP
    is OtaException -> E_DOWNLOAD
    else -> {
      Log.w(TAG, "Unhandled engine failure", error)
      E_UNKNOWN
    }
  }
}

private const val E_STATE = "E_OTA_STATE"
private const val E_CONFIG = "E_OTA_CONFIG"
private const val E_HEALTH = "E_OTA_HEALTH"
private const val E_CHECK = "E_OTA_CHECK"
private const val E_DOWNLOAD = "E_OTA_DOWNLOAD"
private const val E_SWAP = "E_OTA_SWAP"
private const val E_NO_VERSION_UPDATE = "E_OTA_NO_VERSION_UPDATE"
private const val E_UNKNOWN = "E_OTA_UNKNOWN"
