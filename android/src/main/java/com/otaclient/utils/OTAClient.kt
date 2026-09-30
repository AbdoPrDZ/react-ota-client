package com.otaclient.utils

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonSyntaxException
import com.google.gson.reflect.TypeToken
import com.otaclient.data.APIResponse
import com.otaclient.data.AppInfo
import com.otaclient.data.CheckUpdate
import com.otaclient.data.DownloadBundle
import com.otaclient.data.Manifest
import com.otaclient.ota.OtaConfig
import com.otaclient.ota.OtaHost
import com.otaclient.ota.OtaServerConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.statement.bodyAsText
import io.ktor.http.Parameters
import io.ktor.http.isSuccess
import io.ktor.serialization.gson.gson
import java.io.File

/**
 * The update engine's HTTP layer.
 *
 * One instance per process, bound to the application context:
 *
 * ```kotlin
 * val client = OTAClient.instance(context)
 * val check = client.checkUpdate()
 * if (check.haveBundleUpdate) {
 *   val staged = client.downloadBundle(check) { done, total -> … }
 * }
 * ```
 */
class OTAClient private constructor(private val appContext: Context) {

  private val gson = Gson()

  /** Result of the last [checkUpdate], reused by [downloadBundle] and [appUpdateUrl]. */
  @Volatile
  var lastCheck: CheckUpdate? = null
    private set

  val client: HttpClient = HttpClient(CIO) {
    expectSuccess = false

    install(ContentNegotiation) {
      gson()
    }

    install(HttpTimeout) {
      requestTimeoutMillis = REQUEST_TIMEOUT_MS
      connectTimeoutMillis = CONNECT_TIMEOUT_MS
      socketTimeoutMillis = REQUEST_TIMEOUT_MS
    }
  }

  private val config: OtaServerConfig
    get() = OtaConfig.serverConfig(
      appContext,
      OtaServerConfig(
        apiBaseUrl = AppStorage.API_BASE_URL,
        apiVersion = AppStorage.API_VERSION,
        apiKey = AppStorage.API_KEY,
      ),
    )

  private val deviceInfoHeader: String
    get() = AppStorage.deviceInfo(appContext).toHeaderValue()

  /** `GET {apiRoot}/health`; resolves `false` for any failure instead of throwing. */
  suspend fun healthCheck(): Boolean {
    val settings = config

    if (!settings.isConfigured) {
      return false
    }

    return try {
      val response = client.get("${settings.apiRootUrl}/health") {
        headers {
          append("Accept", "application/json")
          append("API-KEY", settings.apiKey)
          append("X-Device-Info", deviceInfoHeader)
        }
      }

      response.status.isSuccess()
    } catch (e: Exception) {
      Log.w(TAG, "Health check failed: ${e.message}")
      false
    }
  }

  /** `POST {apiRoot}/app/info` for this package/version/bundle triple. */
  suspend fun appInfo(): AppInfo? {
    val settings = config

    if (!settings.isConfigured) {
      return null
    }

    return try {
      val response = client.submitForm(
        url = "${settings.apiRootUrl}/app/info",
        formParameters = Parameters.build {
          append("package", OtaHost.packageName(appContext))
          append("version", OtaHost.versionName(appContext))
          append("bundle", AppStorage.MANIFEST.version)
        },
      ) {
        headers {
          append("Accept", "application/json")
          append("API-KEY", settings.apiKey)
          append("X-Device-Info", deviceInfoHeader)
        }
      }

      if (!response.status.isSuccess()) {
        Log.w(TAG, "app/info returned ${response.status.value}")
        return null
      }

      // Parsed from the raw text: `body<APIResponse<AppInfo>>()` would need the
      // response body to still be unread.
      val body = response.bodyAsText()
      val type = object : TypeToken<APIResponse<AppInfo>>() {}.type

      gson.fromJson<APIResponse<AppInfo>>(body, type)?.data
    } catch (e: JsonSyntaxException) {
      Log.e(TAG, "app/info returned malformed JSON: ${e.message}")
      null
    } catch (e: Exception) {
      Log.w(TAG, "app/info failed: ${e.message}")
      null
    }
  }

  /** Asks the server whether a newer APK and/or bundle exists. Caches the result. */
  suspend fun checkUpdate(): CheckUpdate {
    val info = appInfo()

    val version = info?.availableUpdates?.version
    val bundle = info?.availableUpdates?.bundle
    val haveVersionUpdate = version != null
    val haveBundleUpdate = bundle != null

    if (version != null) {
      Log.i(TAG, "New app version available: ${version.name}")
    }

    if (bundle != null) {
      Log.i(TAG, "New bundle available: ${bundle.name}")
    }

    val result = CheckUpdate(
      haveUpdate = haveVersionUpdate || haveBundleUpdate,
      haveVersionUpdate = haveVersionUpdate,
      haveBundleUpdate = haveBundleUpdate,
      appInfo = info,
    )

    lastCheck = result

    return result
  }

  /**
   * Downloads, extracts, verifies and stages the bundle described by [check].
   *
   * The archive is expanded into a temp directory first and only moved into
   * `filesDir/{runtimeVersion}-{version}` once the manifest, the bundle file, its
   * size and its MD5 all check out. Nothing is activated here — that is
   * `OtaBundleProvider.activate()`.
   */
  suspend fun downloadBundle(
    check: CheckUpdate,
    onProgress: (downloaded: Long, total: Long?) -> Unit = { _, _ -> },
  ): DownloadBundle {
    val settings = config
    val updateId = check.appInfo?.availableUpdates?.bundle?.id
      ?: throw OtaException("No bundle update to download")
    val session = check.appInfo?.session.orEmpty()

    val filesDir = appContext.filesDir
    val workingDir = File(filesDir, "ota-new-update-${System.currentTimeMillis()}")
    val archiveFile = File(workingDir, "archive.tar.gz")
    val extractDir = File(workingDir, "extracted")

    try {
      workingDir.mkdirs()

      client.downloadFile(
        url = "${settings.apiRootUrl}/app/update/bundle/$updateId",
        file = archiveFile,
        block = {
          headers {
            append("API-KEY", settings.apiKey)
            append("X-Device-Info", deviceInfoHeader)
            append("Authorization", "Bearer $session")
          }
        },
        onProgress = onProgress,
      )

      extractTarGz(archiveFile, extractDir)

      val manifestFile = File(extractDir, AppStorage.MANIFEST_FILE)
      val manifest = AppStorage.readManifest(manifestFile)
        ?: throw OtaException("${AppStorage.MANIFEST_FILE} is missing or malformed in the archive")

      val bundleFile = File(extractDir, manifest.bundle)

      if (!bundleFile.isFile) {
        throw OtaException("Bundle '${manifest.bundle}' is missing from the archive")
      }

      verifyBundle(manifest, bundleFile)

      val finalDir = File(filesDir, manifest.directoryName)
      finalDir.deleteRecursively()

      if (!finalDir.mkdirs()) {
        throw OtaException("Unable to create ${finalDir.absolutePath}")
      }

      val finalBundleFile = File(finalDir, manifest.bundle)
      val finalManifestFile = File(finalDir, AppStorage.MANIFEST_FILE)

      bundleFile.copyTo(finalBundleFile, overwrite = true)
      manifestFile.copyTo(finalManifestFile, overwrite = true)

      if (!finalBundleFile.isFile || !finalManifestFile.isFile) {
        throw OtaException("Staging ${finalDir.absolutePath} failed")
      }

      Log.i(TAG, "Staged bundle ${manifest.version} in ${finalDir.absolutePath}")

      return DownloadBundle(finalDir, manifest, finalBundleFile, finalManifestFile)
    } catch (e: Exception) {
      workingDir.deleteQuietly()
      throw if (e is OtaException) e else OtaException("Download failed: ${e.message}")
    }
  }

  /**
   * Download URL for a new APK. The session token and device id travel as query
   * parameters because the request is opened by a browser, which cannot set
   * headers.
   */
  fun appUpdateUrl(check: CheckUpdate = lastCheck ?: CheckUpdate(false, false, false, null)): String {
    val settings = config
    val updateId = check.appInfo?.availableUpdates?.version?.id
      ?: throw OtaException("No app version update to open")
    val session = check.appInfo?.session.orEmpty()
    val deviceId = AppStorage.deviceInfo(appContext).androidId.orEmpty()

    return "${settings.apiRootUrl}/app/update/version/$updateId?did=$deviceId&token=$session"
  }

  private fun verifyBundle(manifest: Manifest, bundleFile: File) {
    manifest.size?.let { expected ->
      val actual = bundleFile.length()

      if (expected > 0 && actual != expected) {
        throw OtaException("Bundle size mismatch: expected $expected bytes, got $actual")
      }
    }

    val expectedChecksum = manifest.checksum?.takeIf { it.isNotBlank() } ?: return

    if (!OtaConfig.verifyChecksum(appContext)) {
      return
    }

    val actual = md5(bundleFile)

    if (!actual.equals(expectedChecksum, ignoreCase = true)) {
      throw OtaException("Bundle checksum mismatch: expected $expectedChecksum, got $actual")
    }
  }

  fun close() {
    runCatching { client.close() }
  }

  companion object {
    private const val TAG = "OtaClient"
    private const val REQUEST_TIMEOUT_MS = 5 * 60 * 1000L
    private const val CONNECT_TIMEOUT_MS = 30 * 1000L

    @Volatile
    private var _instance: OTAClient? = null

    /** Shared client, bound to the application context of [context]. */
    @JvmStatic
    fun instance(context: Context): OTAClient {
      val app = context.applicationContext
      val current = _instance

      if (current != null && current.appContext === app) {
        return current
      }

      return synchronized(this) {
        val existing = _instance

        if (existing != null && existing.appContext === app) {
          existing
        } else {
          existing?.close()
          OTAClient(app).also { _instance = it }
        }
      }
    }

    /** Releases the HTTP client, e.g. from a test. */
    @JvmStatic
    fun closeInstance() {
      synchronized(this) {
        _instance?.close()
        _instance = null
      }
    }
  }
}

/** Error with a message meant for the user, as opposed to a programming bug. */
class OtaException(message: String) : Exception(message)
