package com.example.floatingpet

import android.Manifest
import android.app.Activity
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
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            webViewClient = WebViewClient()
            addJavascriptInterface(Bridge(), "PetAndroid")
            loadUrl("file:///android_asset/index.html")
        }
        setContentView(web)
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4)
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
                    if (!isFinishing && !isDestroyed) web.evaluateJavascript("window.onPetUpdate(${result});", null)
                }
            }.start()
        }
        @JavascriptInterface fun openUpdate(url: String) {
            val repo = getPreferences(MODE_PRIVATE).getString("updateRepo", BuildConfig.UPDATE_REPO).orEmpty()
            if (!UpdateChecker.allowedDownload(url, repo)) return
            runOnUiThread { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        }
        @JavascriptInterface fun getState(): String = store.read().toString()
        @JavascriptInterface fun action(name: String): String = store.act(name).toString()
        @JavascriptInterface fun setMode(name: String): String {
            val state = store.setMode(name)
            sendService("refresh")
            return state.toString()
        }
        @JavascriptInterface fun startPet(): Boolean {
            if (!Settings.canDrawOverlays(this@MainActivity)) {
                runOnUiThread {
                    startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName")))
                }
                return false
            }
            runOnUiThread { sendService("start") }
            return true
        }
        @JavascriptInterface fun stopPet() { runOnUiThread { sendService("stop") } }
        @JavascriptInterface fun hasOverlayPermission(): Boolean = Settings.canDrawOverlays(this@MainActivity)
    }
    private fun sendService(command: String) {
        val intent = Intent(this, PetOverlayService::class.java).putExtra("command", command)
        if (command == "stop") stopService(intent)
        else if (command == "start") startForegroundService(intent)
        else if (PetOverlayService.running) startService(intent)
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
