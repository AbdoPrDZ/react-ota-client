package com.otaclient.ota

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.otaclient.R
import com.otaclient.data.CheckUpdate
import com.otaclient.utils.AppStorage
import com.otaclient.utils.OTAClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/**
 * Optional native-first entry point: check and install a bundle *before* React
 * Native boots.
 *
 * The default, recommended integration is the JS-first flow
 * (`<OTAProvider>` in the app root), which needs no `AndroidManifest.xml` change
 * and gives you a themed update screen. This activity exists for the case where
 * you want the update to land even if the embedded bundle cannot start at all:
 *
 * ```xml
 * <activity
 *     android:name="com.otaclient.ota.OtaSplashActivity"
 *     android:exported="true"
 *     android:noHistory="true">
 *   <intent-filter>
 *     <action android:name="android.intent.action.MAIN" />
 *     <category android:name="android.intent.category.LAUNCHER" />
 *   </intent-filter>
 * </activity>
 * ```
 *
 * Whichever entry point you use, the host's React Native activity is found via
 * `ota_client_main_activity` meta-data or by scanning the manifest, and the
 * download is verified before the restart.
 */
class OtaSplashActivity : AppCompatActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.ota_activity_splash)

    AppStorage.init(this)
    AppStorage.deviceInfo(this)

    if (!OtaConfig.autoCheck(this)) {
      launchOtaMain()
      return
    }

    val title = findViewById<TextView>(R.id.ota_title)
    title.text = OtaHost.appLabel(this)
    setStatus(getString(R.string.ota_loading))

    lifecycleScope.launch {
      try {
        val healthy = withContext(Dispatchers.IO) { client().healthCheck() }

        if (!healthy) {
          onServerUnreachable()
          return@launch
        }

        val check = withContext(Dispatchers.IO) { client().checkUpdate() }

        if (!check.haveUpdate) {
          launchOtaMain()
          return@launch
        }

        // A new APK can only be installed from the package installer, which means
        // leaving the app. The bundle update is always handled first, because it
        // is the one this engine can do on its own.
        if (check.haveBundleUpdate && !installBundleUpdate(check)) {
          launchOtaMain()
          return@launch
        }

        if (check.haveVersionUpdate) {
          val accepted = confirmUpdate(
            title = getString(R.string.ota_update_title),
            message = getString(R.string.ota_app_update_message),
          )

          if (accepted) {
            val url = withContext(Dispatchers.IO) { client().appUpdateUrl(check) }
            OtaConfig.openDownloadUrl(this@OtaSplashActivity, url)
            finish()
          } else {
            launchOtaMain()
          }

          return@launch
        }

        launchOtaMain()
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Log.e(TAG, "Update check failed, starting the current bundle", e)
        setStatus(getString(R.string.ota_download_failed))
        launchOtaMain()
      }
    }
  }

  /**
   * @return `true` when the app was restarted into the new bundle, `false` when
   *   the user declined or the download failed.
   */
  private suspend fun installBundleUpdate(check: CheckUpdate): Boolean {
    val accepted = confirmUpdate(
      title = getString(R.string.ota_update_title),
      message = getString(R.string.ota_bundle_update_message),
    )

    if (!accepted) {
      return false
    }

    setStatus(getString(R.string.ota_downloading_unknown_size))

    val result = withContext(Dispatchers.IO) {
      client().downloadBundle(check) { downloaded, total ->
        runOnUiThread { onDownloadProgress(downloaded, total) }
      }
    }

    OtaBundleProvider.activate(this, result.downloadDir)

    OtaConfig.restart(this)

    return true
  }

  private fun onDownloadProgress(downloaded: Long, total: Long?) {
    val bar = findViewById<ProgressBar>(R.id.ota_progress_bar)
    val text = findViewById<TextView>(R.id.ota_progress_text)

    bar.visibility = View.VISIBLE
    text.visibility = View.VISIBLE

    if (total == null || total <= 0L) {
      bar.isIndeterminate = true
      text.text = getString(R.string.ota_downloading_unknown_size)
      return
    }

    val percent = ((downloaded * 100) / total).toInt().coerceIn(0, 100)

    bar.isIndeterminate = false
    bar.max = 100
    bar.progress = percent
    text.text = getString(R.string.ota_downloading, percent)
  }

  private fun setStatus(message: String) {
    findViewById<TextView>(R.id.ota_loading_text).text = message
  }

  private fun onServerUnreachable() {
    if (OtaConfig.showConfigure(this)) {
      startActivity(Intent(this, OtaConfigureActivity::class.java))
      finish()
      return
    }

    launchOtaMain()
  }

  private fun client(): OTAClient = OTAClient.instance(this)

  /** Non-cancellable prompt, suspending until the user answers. */
  private suspend fun confirmUpdate(title: String, message: String): Boolean =
    suspendCancellableCoroutine { continuation ->
      AlertDialog.Builder(this)
        .setTitle(title)
        .setMessage(message)
        .setPositiveButton(R.string.ota_install) { _, _ ->
          if (continuation.isActive) continuation.resume(true)
        }
        .setNegativeButton(R.string.ota_not_now) { _, _ ->
          if (continuation.isActive) continuation.resume(false)
        }
        .setCancelable(false)
        .show()
    }

  private companion object {
    const val TAG = "OtaClient"
  }
}
