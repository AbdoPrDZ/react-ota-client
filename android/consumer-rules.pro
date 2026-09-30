# The update engine deserialises its own JSON with Gson, so the model classes and
# the generic APIResponse<T> wrapper must keep their members.
-keep class com.otaclient.data.** { *; }
-keep class com.otaclient.ota.** { *; }
-keep class com.otaclient.OtaClientModule { *; }
-keep class com.otaclient.OtaClientPackage { *; }

# Ktor + Okio/JDK8 platform classes.
-dontwarn io.ktor.**
-dontwarn org.slf4j.**
-dontwarn kotlinx.coroutines.**
