package com.otaclient.data

/**
 * Device fingerprint, cached on first use and sent in the `X-Device-Info`
 * header of every request.
 */
data class DeviceInfo(
  val androidId: String? = null,
  val manufacturer: String = "",
  val brand: String = "",
  val model: String = "",
  val androidVersion: String = "",
  val sdkVersion: Int = 0,
  val supportedAbis: List<String> = emptyList(),
) {
  /** `did=…;mf=…;br=…;mdl=…;av=…;sdv=…` */
  fun toHeaderValue(): String =
    "did=$androidId;mf=$manufacturer;br=$brand;mdl=$model;av=$androidVersion;sdv=$sdkVersion"
}
