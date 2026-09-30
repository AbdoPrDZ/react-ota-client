package com.otaclient.utils

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.isSuccess
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream

private const val TAG = "OtaClient"

/**
 * Streams a URL straight to disk.
 *
 * `onProgress` receives the bytes written so far and the total, which is `null`
 * when the server omits `Content-Length` — the UI then shows an indeterminate bar.
 * The partial file is removed when the transfer fails.
 */
suspend fun HttpClient.downloadFile(
  url: String,
  file: File,
  block: HttpRequestBuilder.() -> Unit = {},
  onProgress: (downloaded: Long, total: Long?) -> Unit = { _, _ -> },
) {
  prepareGet(url, block).execute { response ->
    if (!response.status.isSuccess()) {
      throw Exception("Failed to download $url: ${response.status.value} ${response.status.description}")
    }

    val channel = response.bodyAsChannel()
    val total = response.headers["Content-Length"]?.toLongOrNull()
    var downloaded = 0L

    try {
      FileOutputStream(file).use { output ->
        val buffer = ByteBuffer.allocate(DEFAULT_BUFFER_SIZE)

        while (true) {
          buffer.clear()
          val read = channel.readAvailable(buffer)

          if (read == -1) {
            break
          }

          output.write(buffer.array(), 0, read)
          downloaded += read
          onProgress(downloaded, total)
        }

        output.flush()
      }
    } catch (e: Exception) {
      file.delete()
      throw e
    }
  }
}

/**
 * Expands a `.tar.gz` into [outputDir].
 *
 * Entries are created relative to [outputDir] and paths that try to escape it
 * are skipped, so a hostile archive cannot write outside the staging directory.
 */
fun extractTarGz(archiveFile: File, outputDir: File) {
  if (!outputDir.exists() && !outputDir.mkdirs()) {
    throw Exception("Unable to create ${outputDir.absolutePath}")
  }

  val root = outputDir.canonicalFile
  var entryCount = 0

  TarArchiveInputStream(GzipCompressorInputStream(FileInputStream(archiveFile))).use { tar ->
    var entry = tar.nextEntry

    while (entry != null) {
      val outputFile = File(root, entry.name)

      if (isInside(root, outputFile)) {
        if (entry.isDirectory) {
          outputFile.mkdirs()
        } else {
          outputFile.parentFile?.mkdirs()
          outputFile.outputStream().use { stream -> tar.copyTo(stream) }
        }

        entryCount++
      } else {
        Log.w(TAG, "Skipping archive entry outside of the target directory: ${entry.name}")
      }

      entry = tar.nextEntry
    }
  }

  if (entryCount == 0) {
    throw Exception("Archive ${archiveFile.name} is empty")
  }
}

private fun isInside(root: File, candidate: File): Boolean {
  val canonical = candidate.canonicalFile
  return canonical == root || canonical.path.startsWith(root.path + File.separator)
}

/** Lowercase hex MD5, used to verify a downloaded bundle against the manifest. */
fun md5(file: File): String {
  val digest = MessageDigest.getInstance("MD5")
  val buffer = ByteArray(DEFAULT_BUFFER_SIZE)

  file.inputStream().use { stream ->
    while (true) {
      val read = stream.read(buffer)

      if (read <= 0) {
        break
      }

      digest.update(buffer, 0, read)
    }
  }

  return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
}

/** Recursive delete that never throws, for best-effort cleanup of temp dirs. */
fun File.deleteQuietly(): Boolean = try {
  if (!exists()) {
    true
  } else {
    deleteRecursively()
  }
} catch (e: Exception) {
  Log.w(TAG, "Unable to delete ${absolutePath}", e)
  false
}
