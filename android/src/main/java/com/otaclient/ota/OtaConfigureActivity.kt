package com.otaclient.ota

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.otaclient.R
import com.otaclient.utils.AppStorage

/**
 * Fallback server setup screen, shown when the OTA server cannot be reached and
 * the host has no server coordinates yet.
 *
 * Optional: the JavaScript `OTAConfigureScreen` covers the same ground and is
 * usually the better choice. Use this one only for the native-first flow, or to
 * rescue a device that cannot load the bundle which would render the JS screen.
 */
class OtaConfigureActivity : AppCompatActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.ota_activity_configure)

    AppStorage.init(this)

    val baseUrl = findViewById<EditText>(R.id.ota_input_base_url)
    val apiVersion = findViewById<EditText>(R.id.ota_input_api_version)
    val apiKey = findViewById<EditText>(R.id.ota_input_api_key)
    val error = findViewById<TextView>(R.id.ota_configure_error)
    val save = findViewById<Button>(R.id.ota_configure_save)

    val config = OtaConfig.serverConfig(
      this,
      OtaServerConfig(AppStorage.API_BASE_URL, AppStorage.API_VERSION, AppStorage.API_KEY),
    )

    // Only prefill what came from the app itself; an empty field stays empty.
    if (baseUrl.text.isNullOrBlank()) {
      baseUrl.setText(config.apiBaseUrl)
    }

    if (apiVersion.text.isNullOrBlank()) {
      apiVersion.setText(config.apiVersion.ifBlank { OtaConfig.DEFAULT_API_VERSION })
    }

    if (apiKey.text.isNullOrBlank()) {
      apiKey.setText(config.apiKey)
    }

    save.setOnClickListener {
      val url = baseUrl.text.toString().trim().trimEnd('/')

      if (url.isEmpty()) {
        showError(error, getString(R.string.ota_configure_base_url) + " is required")
        return@setOnClickListener
      }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        showError(error, "\"$url\" is not a valid URL")
        return@setOnClickListener
      }

      AppStorage.API_BASE_URL = url
      AppStorage.API_VERSION = apiVersion.text.toString()
        .trim()
        .trim('/')
        .ifBlank { OtaConfig.DEFAULT_API_VERSION }
      AppStorage.API_KEY = apiKey.text.toString().trim()

      Toast.makeText(this, R.string.ota_configure_saved, Toast.LENGTH_SHORT).show()
      launchMain()
    }
  }

  private fun showError(view: TextView, message: String) {
    Log.w(TAG, message)
    view.text = message
    view.visibility = View.VISIBLE
  }

  private fun launchMain() {
    val intent = OtaHost.mainActivityIntent(this)

    if (intent == null) {
      Log.e(TAG, "Cannot find the host activity; set ota_client_main_activity in AndroidManifest.xml")
      finish()
      return
    }

    startActivity(intent)
    finish()
  }

  private companion object {
    const val TAG = "OtaClient"
  }
}

/** Overload used by [OtaSplashActivity] to jump straight back into the flow. */
internal fun AppCompatActivity.launchOtaMain() {
  val intent: Intent = OtaHost.mainActivityIntent(this)
    ?: run {
      Log.e("OtaClient", "Cannot find the host activity; set ota_client_main_activity in AndroidManifest.xml")
      finish()
      return
    }

  startActivity(intent)
  finish()
}
