package com.otaclient.ota

import android.content.Context
import android.graphics.Typeface
import android.os.Process
import android.util.Log
import com.facebook.react.common.assets.ReactFontManager
import com.otaclient.data.BundleState
import com.otaclient.data.Manifest
import com.otaclient.utils.AppStorage
import com.otaclient.utils.deleteQuietly
import java.io.File

/**
 * Decides which JavaScript bundle React Native loads, and owns the swap.
 *
 * The single method a host app has to wire up is [getJSBundleFile]:
 *
 * ```kotlin
 * override fun getJSBundleFile(): String? =
 *   OtaBundleProvider.getJSBundleFile(applicationContext)
 * ```
 *
 * Returning `null` hands control back to React Native, which either serves the
 * bundle embedded in the APK or connects to Metro in debug builds.
 *
 * ### Automatic rollback
 *
 * A bundle that throws while booting would leave the app bricked with no way to
 * recover, so every activation is treated as provisional: the PID of the process
 * that started it is remembered ([AppStorage.PENDING_PID]) and only cleared by
 * [markLaunchSucceeded], which the JS layer calls shortly after mount. If the
 * next process start still sees a pending PID from another process, the previous
 * bundle is restored — or the embedded copy, when there is none.
 */
object OtaBundleProvider {

  private const val TAG = "OtaClient"

  private const val TEMP_DIR_PREFIX = "ota-new-update-"

  /** Font file extensions accepted from a bundle's `fonts` directory. */
  private val FONT_EXTENSIONS = setOf("ttf", "otf")

  /**
   * Path of the bundle to load, or `null` to let React Native fall back to the
   * bundle embedded in the APK.
   */
  fun getJSBundleFile(context: Context): String? {
    val app = context.applicationContext
    AppStorage.init(app)

    rollbackIfUnconfirmed(app)

    if (!OtaConfig.isEnabled(app)) {
      return null
    }

    val directory = AppStorage.RUNNING_BUNDLE_DIR ?: return null
    val manifest = AppStorage.MANIFEST
    val hostVersion = OtaHost.versionName(app)

    if (manifest.runtimeVersion != hostVersion) {
      Log.w(
        TAG,
        "Discarding bundle ${manifest.version}: runtimeVersion ${manifest.runtimeVersion} " +
          "does not match the app version $hostVersion",
      )
      AppStorage.clearRunningBundle()
      return null
    }

    val bundleFile = File(directory, manifest.bundle)

    if (!bundleFile.isFile) {
      Log.w(TAG, "Discarding bundle ${manifest.version}: ${bundleFile.absolutePath} is gone")
      AppStorage.clearRunningBundle()
      return null
    }

    // Provisionally accept this process as the one that must confirm the bundle.
    if (AppStorage.PENDING_PID == 0) {
      AppStorage.PENDING_PID = Process.myPid()
    }

    registerBundleFonts(directory)

    return bundleFile.absolutePath
  }

  /**
   * Registers the fonts shipped inside the active bundle so React Native uses
   * them instead of the copies embedded in the APK.
   *
   * React Native resolves a font family from `assets/fonts/<family>` in the APK
   * only, so a bundle could never change a font on its own. `ReactFontManager`
   * checks its custom typeface cache before the asset folder, which makes this
   * the only way an OTA update can ship new glyphs.
   *
   * The cache lives for the whole process, so this has to run before the first
   * icon renders. [getJSBundleFile] is called exactly then, while React Native
   * boots, and a font swap only ever happens together with a restart.
   */
  private fun registerBundleFonts(directory: File) {
    val fontsDir = File(directory, AppStorage.FONTS_DIR)

    if (!fontsDir.isDirectory) {
      return
    }

    val fonts = fontsDir.listFiles { file -> file.isFile }
      ?.filter { FONT_EXTENSIONS.contains(it.extension.lowercase()) }
      ?.sortedBy { it.name }
      .orEmpty()

    if (fonts.isEmpty()) {
      return
    }

    val manager = ReactFontManager.getInstance()

    for (font in fonts) {
      // react-native-vector-icons passes the file name without its extension as
      // the family on Android, so the file name is the family to register under.
      val family = font.nameWithoutExtension

      try {
        manager.addCustomFont(family, Typeface.createFromFile(font))
        Log.i(TAG, "Registered bundle font '$family' from ${font.absolutePath}")
      } catch (e: Exception) {
        // A broken font must never stop the app from booting; React Native keeps
        // resolving the copy embedded in the APK.
        Log.w(TAG, "Unable to register bundle font ${font.absolutePath}", e)
      }
    }
  }

  /**
   * Marks the running bundle as good, so a failure on the *next* update does not
   * roll back to an older one.
   */
  fun markLaunchSucceeded(context: Context) {
    val app = context.applicationContext
    AppStorage.init(app)

    AppStorage.RUNNING_BUNDLE_DIR?.let { AppStorage.LAST_GOOD_BUNDLE_DIR = it }
    AppStorage.PENDING_PID = 0
  }

  /**
   * Makes [directory] the active bundle, remembering the previous one as the
   * fallback. Pass `null` to go back to the copy embedded in the APK.
   *
   * @throws IllegalStateException when the directory has no usable manifest or
   *   was built for a different native runtime.
   */
  fun activate(context: Context, directory: File?): BundleState {
    val app = context.applicationContext
    AppStorage.init(app)

    if (directory == null) {
      revertToEmbedded(app)
      return currentState(app)
    }

    if (!directory.isDirectory) {
      throw OtaSwapException("${directory.absolutePath} is not a bundle directory")
    }

    val manifest = AppStorage.readManifest(File(directory, AppStorage.MANIFEST_FILE))
      ?: throw OtaSwapException("No ${AppStorage.MANIFEST_FILE} in ${directory.absolutePath}")

    val hostVersion = OtaHost.versionName(app)

    if (manifest.runtimeVersion != hostVersion) {
      throw OtaSwapException(
        "Bundle ${manifest.version} targets native runtime ${manifest.runtimeVersion} " +
          "but the app is $hostVersion",
      )
    }

    if (!File(directory, manifest.bundle).isFile) {
      throw OtaSwapException("Bundle file '${manifest.bundle}' is missing from ${directory.absolutePath}")
    }

    val previous = AppStorage.RUNNING_BUNDLE_DIR

    if (previous != null && previous.absolutePath != directory.absolutePath) {
      AppStorage.LAST_GOOD_BUNDLE_DIR = previous
    }

    AppStorage.RUNNING_BUNDLE_DIR = directory
    AppStorage.PENDING_PID = 0
    AppStorage.loadManifest(app)

    Log.i(TAG, "Activated bundle ${manifest.version} from ${directory.absolutePath}")

    return currentState(app)
  }

  /** Forgets the downloaded bundle so the next start uses the APK copy. */
  fun revertToEmbedded(context: Context): Boolean {
    val app = context.applicationContext
    AppStorage.init(app)

    val hadBundle = AppStorage.RUNNING_BUNDLE_DIR != null
    AppStorage.RUNNING_BUNDLE_DIR = null
    AppStorage.PENDING_PID = 0
    AppStorage.loadManifest(app)

    return hadBundle
  }

  /** Description of the bundle that would be loaded right now. */
  fun currentState(context: Context): BundleState {
    val app = context.applicationContext
    AppStorage.init(app)

    val directory = AppStorage.RUNNING_BUNDLE_DIR
    val enabled = OtaConfig.isEnabled(app)

    if (directory == null || !enabled) {
      return BundleState(
        manifest = AppStorage.MANIFEST,
        source = BundleState.SOURCE_EMBEDDED,
        path = null,
      )
    }

    val manifest: Manifest = AppStorage.MANIFEST

    return BundleState(
      manifest = manifest,
      source = BundleState.SOURCE_DOWNLOADED,
      path = File(directory, manifest.bundle).absolutePath,
    )
  }

  /**
   * `true` while a bundle is running that has not been confirmed yet.
   * The JS layer resolves this by calling `markLaunchSucceeded()`.
   */
  fun isLaunchPending(context: Context): Boolean {
    AppStorage.init(context.applicationContext)
    return AppStorage.PENDING_PID != 0
  }

  /** `true` when the host app is debuggable and the engine is standing down. */
  fun isUsingDevServer(context: Context): Boolean =
    OtaHost.isDebuggable(context) && !OtaConfig.isEnabled(context)

  /**
   * Deletes staging directories that are neither active nor the rollback target,
   * keeping the [keep] newest ones, plus any leftover temp directories.
   *
   * @return how many directories were removed.
   */
  fun cleanup(context: Context, keep: Int): Int {
    val app = context.applicationContext
    AppStorage.init(app)

    val filesDir = app.filesDir
    val keepPaths = setOfNotNull(
      AppStorage.RUNNING_BUNDLE_DIR?.absolutePath,
      AppStorage.LAST_GOOD_BUNDLE_DIR?.absolutePath,
    )

    var removed = 0

    filesDir.listFiles()
      ?.filter { it.isDirectory && it.name.startsWith(TEMP_DIR_PREFIX) }
      ?.forEach {
        it.deleteQuietly()
        removed++
      }

    val stale = filesDir.listFiles()
      ?.filter {
        it.isDirectory &&
          it.absolutePath !in keepPaths &&
          File(it, AppStorage.MANIFEST_FILE).isFile
      }
      ?.sortedByDescending { it.lastModified() }
      .orEmpty()

    stale.drop(keep.coerceAtLeast(0)).forEach {
      it.deleteQuietly()
      removed++
    }

    if (removed > 0) {
      Log.i(TAG, "Cleaned up $removed bundle directories")
    }

    return removed
  }

  /**
   * Restores the previous bundle when the process that started the current one
   * died without confirming it. Runs on every [getJSBundleFile] call.
   */
  private fun rollbackIfUnconfirmed(context: Context) {
    val pendingPid = AppStorage.PENDING_PID

    if (pendingPid == 0 || pendingPid == Process.myPid()) {
      return
    }

    val previous = AppStorage.LAST_GOOD_BUNDLE_DIR
    val version = AppStorage.MANIFEST.version

    Log.w(TAG, "Bundle $version did not start (pid $pendingPid), rolling back")

    if (previous != null) {
      AppStorage.RUNNING_BUNDLE_DIR = previous
    } else {
      AppStorage.RUNNING_BUNDLE_DIR = null
    }

    AppStorage.PENDING_PID = 0
    AppStorage.loadManifest(context)
  }
}

/** Raised when a bundle cannot be activated (missing files, wrong runtime, …). */
class OtaSwapException(message: String) : Exception(message)
