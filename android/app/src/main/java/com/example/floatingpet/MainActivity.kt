package com.example.floatingpet

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
    private lateinit var web: WebView
    private val store by lazy { PetStore(this) }
    private var latestUpdate: org.json.JSONObject? = null
    private var pendingApk: java.io.File? = null
    private val downloading = java.util.concurrent.atomic.AtomicBoolean(false)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            webViewClient = object: WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: android.webkit.WebResourceRequest): Boolean {
                    if (request.url.scheme == "https") startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    return request.url.scheme != "file"
                }
            }
            addJavascriptInterface(Bridge(), "PetAndroid")
            loadUrl("file:///android_asset/index.html")
        }
        setContentView(web)
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4)
        createUpdateChannel()
    }
    inner class Bridge {
        @JavascriptInterface fun updateInfo(): String = org.json.JSONObject()
            .put("repo", getPreferences(MODE_PRIVATE).getString("updateRepo", BuildConfig.UPDATE_REPO))
            .put("versionCode", BuildConfig.VERSION_CODE).put("versionName", BuildConfig.VERSION_NAME).toString()
        @JavascriptInterface fun saveUpdateRepo(repo: String): Boolean {
            if (!repo.matches(Regex("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"))) return false
            getPreferences(MODE_PRIVATE).edit().putString("updateRepo", repo).apply()
            return true
        }
        @JavascriptInterface fun checkUpdate() {
            Thread {
                val repo = getPreferences(MODE_PRIVATE).getString("updateRepo", BuildConfig.UPDATE_REPO).orEmpty()
                val result = UpdateChecker.check(repo, BuildConfig.VERSION_CODE)
                runOnUiThread {
                    if (!result.has("error")) {
                        if (latestUpdate?.optString("sha256") != result.optString("sha256")) pendingApk = null
                        latestUpdate = result
                        if (result.optBoolean("available")) notifyUpdate(result)
                    }
                    if (!isFinishing && !isDestroyed) web.evaluateJavascript("window.onPetUpdate(${result});", null)
                }
            }.start()
        }
        @JavascriptInterface fun openUpdate(url: String) {
            val repo = getPreferences(MODE_PRIVATE).getString("updateRepo", BuildConfig.UPDATE_REPO).orEmpty()
            if (!UpdateChecker.allowedDownload(url, repo)) return
            runOnUiThread { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        }
        @JavascriptInterface fun canAutoDownload(): Boolean {
            val manager = getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val caps = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
            return caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)
        }
        @JavascriptInterface fun prepareUpdate() { downloadUpdate(false) }
        @JavascriptInterface fun installUpdate() { downloadUpdate(true) }
        private fun downloadUpdate(install: Boolean) {
            runOnUiThread {
                val apk = pendingApk
                if (apk != null && apk.exists()) { if (install) requestInstall(apk) else updateReady(); return@runOnUiThread }
                val release = latestUpdate
                if (release == null || !release.optBoolean("available")) { updateStatus("Check for an update first."); return@runOnUiThread }
                if (!downloading.compareAndSet(false, true)) return@runOnUiThread
                updateStatus("Downloading update…")
                val repo = getPreferences(MODE_PRIVATE).getString("updateRepo", BuildConfig.UPDATE_REPO).orEmpty()
                Thread {
                    try {
                        val file = UpdateInstaller.download(this@MainActivity, release, repo)
                        runOnUiThread { pendingApk = file; if (!isFinishing && !isDestroyed) { if (install) requestInstall(file) else updateReady() } }
                    } catch (e: Exception) { runOnUiThread { updateStatus(e.message ?: "Download failed. Retry or use browser download.") } }
                    finally { downloading.set(false) }
                }.start()
            }
        }
        @JavascriptInterface fun shareVisit(url: String) {
            val uri = Uri.parse(url)
            if (uri.scheme != "https" || uri.host !in listOf("tinyfrens.lol", "www.tinyfrens.lol") || uri.path != "/web/" || url.length > 2200) return
            runOnUiThread {
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url) }, "Send a visit invite"))
            }
        }
        @JavascriptInterface fun setGuests(json: String) {
            runOnUiThread {
                val intent = Intent(this@MainActivity, PetOverlayService::class.java).apply {
                    action = PetOverlayService.ACTION_SET_GUESTS
                    putExtra("guests", json)
                }
                if (PetOverlayService.running) startService(intent)
            }
        }
        @JavascriptInterface fun permissions(): String = org.json.JSONObject()
            .put("overlay", Settings.canDrawOverlays(this@MainActivity))
            .put("install", packageManager.canRequestPackageInstalls()).toString()
        @JavascriptInterface fun openSettings(kind: String) { runOnUiThread { settingsLink(kind) } }
        @JavascriptInterface fun customize(json: String): String {
            val state = store.customize(json)
            runOnUiThread { sendService("refresh") }
            return state.toString()
        }
        @JavascriptInterface fun toy() { runOnUiThread { if(store.read().optBoolean("haptics",true))web.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);sendService("toy") } }
        @JavascriptInterface fun getState(): String = store.read().toString()
        @JavascriptInterface fun rename(name: String): String = store.rename(name).toString()
        @JavascriptInterface fun action(name: String): String {
            val state = store.act(name)
            runOnUiThread { if(!state.optBoolean("blocked")&&state.optBoolean("haptics",true))web.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);sendService("refresh") }
            return state.toString()
        }
        @JavascriptInterface fun setMode(name: String): String {
            val state = store.setMode(name)
            sendService("refresh")
            return state.toString()
        }
        @JavascriptInterface fun startPet(): Boolean {
            if (!Settings.canDrawOverlays(this@MainActivity)) {
                runOnUiThread {
                    settingsLink("overlay")
                }
                return false
            }
            runOnUiThread { sendService("start") }
            return true
        }
        @JavascriptInterface fun registerFriends(server: String, petJson: String, requestId: Int) {
            Thread {
                var result = org.json.JSONObject().put("error", "Could not reach the friends server.")
                var connection: javax.net.ssl.HttpsURLConnection? = null
                try {
                    val uri = Uri.parse(server)
                    require(uri.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null && uri.query == null && uri.fragment == null && uri.path.orEmpty() in listOf("", "/"))
                    require(petJson.length <= 512)
                    val payload = org.json.JSONObject().put("pet", org.json.JSONObject(petJson)).toString().toByteArray(Charsets.UTF_8)
                    val request = java.net.URL(server.trimEnd('/') + "/api/register").openConnection() as javax.net.ssl.HttpsURLConnection
                    connection = request
                    request.requestMethod = "POST"; request.connectTimeout = 15000; request.readTimeout = 15000
                    request.instanceFollowRedirects = false; request.doOutput = true
                    request.setRequestProperty("Content-Type", "application/json"); request.setRequestProperty("Origin", "null")
                    request.outputStream.use { it.write(payload) }
                    if (request.responseCode == 200) {
                        val bytes = request.inputStream.use { input ->
                            val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(1024)
                            while (output.size() <= 4096) { val count = input.read(buffer, 0, minOf(buffer.size, 4097-output.size())); if (count < 0) break; output.write(buffer, 0, count) }
                            output.toByteArray()
                        }
                        require(bytes.size <= 4096)
                        result = org.json.JSONObject(String(bytes, Charsets.UTF_8))
                    }
                } catch (_: Exception) { } finally { connection?.disconnect() }
                val response = org.json.JSONObject().put("requestId", requestId).put("result", result)
                runOnUiThread { if (!isDestroyed) web.evaluateJavascript("window.onNativeFriendRegistration?.($response)", null) }
            }.start()
        }
        @JavascriptInterface fun isPetVisible(): Boolean = PetOverlayService.running
        @JavascriptInterface fun stopPet() { runOnUiThread { sendService("stop") } }
        @JavascriptInterface fun hasOverlayPermission(): Boolean = Settings.canDrawOverlays(this@MainActivity)
    }
    private fun updateReady() {
        notifyDownloaded()
        if (!isFinishing && !isDestroyed) web.evaluateJavascript("window.onUpdateReady?.()", null)
    }
    private fun updateStatus(message: String) {
        if (!isFinishing && !isDestroyed && ::web.isInitialized)
            web.evaluateJavascript("window.onUpdateDownload?.(${org.json.JSONObject.quote(message)})", null)
    }
    private fun requestInstall(apk: java.io.File) {
        if (!packageManager.canRequestPackageInstalls()) {
            updateStatus("Allow updates from TinyFrens in Settings, return here, then tap Install update again.")
            settingsLink("install")
        } else {
            try { UpdateInstaller.install(this, apk); updateStatus("Approve Android's installation prompt. If cancelled, tap Install update again.") }
            catch (_: Exception) { updateStatus("Could not open installer. Use browser download.") }
        }
    }
    private fun settingsLink(kind: String) {
        val action = when(kind) {
            "overlay" -> Settings.ACTION_MANAGE_OVERLAY_PERMISSION
            "install" -> Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES
            else -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
        }
        try { startActivity(Intent(action, Uri.parse("package:$packageName"))) }
        catch (_: Exception) { try { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) } catch (_: Exception) {} }
    }
    private fun sendService(command: String) {
        val intent = Intent(this, PetOverlayService::class.java).putExtra("command", command)
        if (command == "stop") { if(PetOverlayService.running)startService(intent.setAction(PetOverlayService.ACTION_HIDE))else stopService(intent) }
        else if (command == "start") startForegroundService(intent)
        else if (PetOverlayService.running) startService(intent)
    }
    private fun createUpdateChannel() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("updates", "TinyFrens updates", NotificationManager.IMPORTANCE_DEFAULT))
    }
    private fun updateIntent(): PendingIntent = PendingIntent.getActivity(
        this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    private fun postUpdateNotification(id: Int, title: String, text: String) {
        try {
            val notification = Notification.Builder(this, "updates")
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(updateIntent())
                .setAutoCancel(true)
                .build()
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(id, notification)
        } catch (_: Exception) { }
    }
    private fun notifyUpdate(result: org.json.JSONObject) {
        val token = result.optString("sha256", result.optString("url"))
        if (token.isBlank()) return
        val prefs = getSharedPreferences("updates", MODE_PRIVATE)
        if (prefs.getString("lastUpdateNotification", "") == token) return
        prefs.edit().putString("lastUpdateNotification", token).apply()
        postUpdateNotification(20, "TinyFrens update ready", "Open TinyFrens to install the new Android build.")
    }
    private fun notifyDownloaded() {
        postUpdateNotification(21, "TinyFrens update downloaded", "Open TinyFrens to finish installing it.")
    }
    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.evaluateJavascript("window.onAndroidResume?.()", null)
    }
    override fun onDestroy() {
        web.removeJavascriptInterface("PetAndroid")
        web.destroy()
        super.onDestroy()
    }
}


