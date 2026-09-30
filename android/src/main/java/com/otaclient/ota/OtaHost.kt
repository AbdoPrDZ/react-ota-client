package com.otaclient.ota

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.otaclient.BuildConfig

/**
 * Reads everything the library needs to know about the *host* app.
 *
 * A library cannot use its own `BuildConfig` for this — `applicationId`,
 * `versionName` and the `DEBUG` flag all live in the app module.
 */
object OtaHost {

  private const val TAG = "OtaClient"

  /** Package name of the host application. */
  fun packageName(context: Context): String = context.applicationContext.packageName

  /** `versionName` from the host's `build.gradle`; also the runtime compatibility key. */
  fun versionName(context: Context): String {
    val app = context.applicationContext

    return try {
      @Suppress("DEPRECATION")
      app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: ""
    } catch (e: PackageManager.NameNotFoundException) {
      Log.w(TAG, "Unable to read versionName", e)
      ""
    }
  }

  fun versionCode(context: Context): Long {
    val app = context.applicationContext

    return try {
      val info = app.packageManager.getPackageInfo(app.packageName, 0)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        info.longVersionCode
      } else {
        @Suppress("DEPRECATION")
        info.versionCode.toLong()
      }
    } catch (e: PackageManager.NameNotFoundException) {
      Log.w(TAG, "Unable to read versionCode", e)
      0L
    }
  }

  /** `true` for debuggable builds, which normally should not load an OTA bundle. */
  fun isDebuggable(context: Context): Boolean =
    (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

  /** Human readable app label, used by the built-in configure screen. */
  fun appLabel(context: Context): String {
    val app = context.applicationContext

    return try {
      val info = app.packageManager.getApplicationInfo(app.packageName, 0)
      app.packageManager.getApplicationLabel(info).toString()
    } catch (e: Exception) {
      Log.w(TAG, "Unable to read the application label", e)
      app.packageName
    }
  }

  /**
   * `<meta-data>` of the host `<application>` tag, where the server coordinates
   * and the feature switches are configured.
   */
  fun applicationMetaData(context: Context): Bundle? =
    try {
      context.applicationContext.applicationInfo.metaData
    } catch (e: Exception) {
      Log.w(TAG, "Unable to read application meta-data", e)
      null
    }

  @Suppress("DEPRECATION") // Bundle.get() is the only accessor that covers every meta-data type.
  fun metaString(context: Context, key: String, fallback: String? = null): String? {
    val value = applicationMetaData(context)?.get(key) ?: return fallback

    return when (value) {
      is String -> value.ifBlank { fallback }
      else -> value.toString()
    }
  }

  @Suppress("DEPRECATION")
  fun metaBoolean(context: Context, key: String, fallback: Boolean): Boolean {
    val value = applicationMetaData(context)?.get(key) ?: return fallback

    return when (value) {
      is Boolean -> value
      is String -> value.toBooleanStrictOrNull() ?: fallback
      else -> fallback
    }
  }

  /**
   * The activity React Native runs, used to relaunch the app after a swap.
   *
   * Resolution order:
   *  1. `ota_client_main_activity` meta-data (explicit, recommended).
   *  2. The single non-library activity declared in the host manifest.
   *  3. The launcher activity declared by the host (skipped if that is this library's splash).
   */
  fun mainActivityClass(context: Context): Class<out Activity>? {
    val app = context.applicationContext
    val configured = metaString(context, OtaConfig.META_MAIN_ACTIVITY)

    if (!configured.isNullOrBlank()) {
      try {
        return Class.forName(configured).asSubclass(Activity::class.java)
      } catch (e: ClassNotFoundException) {
        Log.e(TAG, "ota_client_main_activity '$configured' was not found", e)
      }
    }

    val declared = declaredActivities(app)

    if (declared.isEmpty()) {
      return null
    }

    // Prefer whatever the user taps to start the app, as long as it is not this
    // library's own splash. Otherwise fall back to the only candidate.
    val launcher = launcherActivities(app).firstOrNull { it in declared }
    val candidate = launcher ?: declared.firstOrNull { declared.size == 1 } ?: launcher

    return candidate?.let { loadActivityClass(it) }
  }

  /** Activities the host declares, minus the ones that belong to this library. */
  private fun declaredActivities(context: Context): List<ActivityInfo> = try {
    context.packageManager
      .getPackageInfo(context.packageName, PackageManager.GET_ACTIVITIES)
      ?.activities
      ?.filterNot { it.name.orEmpty().startsWith(LIBRARY_PACKAGE_PREFIX) }
      .orEmpty()
  } catch (e: PackageManager.NameNotFoundException) {
    Log.w(TAG, "Unable to list host activities", e)
    emptyList()
  }

  private fun launcherActivities(context: Context): List<ActivityInfo> = try {
    val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)

    context.packageManager
      .queryIntentActivities(main, 0)
      .map { it.activityInfo }
      .filterNot { it.name.orEmpty().startsWith(LIBRARY_PACKAGE_PREFIX) }
  } catch (e: Exception) {
    Log.w(TAG, "Unable to query the launcher activity", e)
    emptyList()
  }

  /** Intent that relaunches the host's React Native activity, or `null` if unresolved. */
  fun mainActivityIntent(context: Context): Intent? {
    val app = context.applicationContext
    val target = mainActivityClass(app) ?: return null

    return Intent(app, target).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    }
  }

  private fun loadActivityClass(info: ActivityInfo): Class<out Activity>? {
    val className = info.name.orEmpty()

    if (className.isEmpty()) {
      return null
    }

    return try {
      Class.forName(className).asSubclass(Activity::class.java)
    } catch (e: ClassNotFoundException) {
      Log.w(TAG, "Activity $className declared in the manifest was not found", e)
      null
    }
  }

  /** Version of this library, surfaced through `OtaClient.getState()`. */
  val libraryVersion: String
    get() = try {
      BuildConfig.LIBRARY_VERSION
    } catch (e: Throwable) {
      "unknown"
    }

  private const val LIBRARY_PACKAGE_PREFIX = "com.otaclient."
}
