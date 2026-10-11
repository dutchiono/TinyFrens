package com.example.floatingpet

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object UpdateChecker {
    fun allowedDownload(url: String, repo: String): Boolean = try {
        val u = java.net.URI(url)
        u.scheme == "https" && u.host == "github.com" && u.userInfo == null && u.port == -1 &&
            u.path.startsWith("/$repo/releases/download/") && u.path.endsWith("/pocket-familiar.apk")
    } catch (_: Exception) { false }

    fun check(repo: String, installed: Int): JSONObject {
        val out = JSONObject()
        if (!repo.matches(Regex("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")))
            return out.put("error", "Enter your public GitHub repository as owner/repo.")
        return try {
            val conn = URL("https://api.github.com/repos/$repo/releases/latest").openConnection() as HttpURLConnection
            conn.connectTimeout = 10000; conn.readTimeout = 10000
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            conn.setRequestProperty("User-Agent", "Pocket-Familiar")
            val release = try {
                if (conn.responseCode != 200) throw IllegalStateException("No public release available (${conn.responseCode}).")
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                JSONObject(text)
            } finally { conn.disconnect() }
            val assets = release.getJSONArray("assets")
            var manifestUrl = ""
            var apkUrl = ""
            for (i in 0 until assets.length()) {
                val asset = assets.getJSONObject(i)
                if (asset.getString("name") == "update.json") manifestUrl = asset.getString("browser_download_url")
                if (asset.getString("name") == "pocket-familiar.apk") apkUrl = asset.getString("browser_download_url")
            }
            if (!allowedDownload(apkUrl, repo) || manifestUrl != apkUrl.substringBeforeLast('/') + "/update.json")
                throw IllegalStateException("Release is missing its APK or update manifest.")
            val c = URL(manifestUrl).openConnection() as HttpURLConnection
            c.connectTimeout = 10000; c.readTimeout = 10000
            val manifest = try {
                if (c.responseCode != 200) throw IllegalStateException("Cannot read update manifest.")
                JSONObject(c.inputStream.bufferedReader().use { it.readText() })
            } finally { c.disconnect() }
            out.put("available", manifest.getInt("versionCode") > installed)
                .put("versionName", manifest.getString("versionName")).put("url", apkUrl).put("sha256", manifest.optString("sha256"))
        } catch (e: Exception) { out.put("error", e.message ?: "Unable to check for updates.") }
    }
}
