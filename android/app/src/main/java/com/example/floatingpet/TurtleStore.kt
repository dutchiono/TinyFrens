package com.example.floatingpet

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.util.Base64
import com.caverock.androidsvg.SVG
import org.json.JSONObject
import org.json.JSONArray
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Original NFT artwork, verified by the relay. No wallet keys are stored here. */
class TurtleStore(context: Context) {
    private val prefs = context.getSharedPreferences("hood_turtle", Context.MODE_PRIVATE)
    companion object {
        private val lock = Any()
        private val framesCache = mutableMapOf<String, List<Bitmap>>()
        private var refreshing = false
        private var retryAt = 0L
        private var generation = 0L
        const val SERVER = "https://tinyfrens.miono.live"
        private val paths = setOf("/api/register", "/api/wallet-link/status", "/api/wallet-link/challenge",
            "/api/wallet-link/confirm", "/api/wallet-link/disconnect", "/api/wallet-link/nfts", "/api/featured/hood-turtle",
            "/api/turtle-connect/start", "/api/turtle-connect/status", "/api/turtle-connect/accept")
    }

    fun request(server: String, path: String, body: JSONObject): JSONObject {
        if (server == SERVER && path in setOf("/native/remove-turtle", "/native/remove-wallet")) {
            synchronized(lock) {
                generation++
                save(items().filter {
                    if (path == "/native/remove-wallet") !it.optString("wallet", it.optString("originalOwner")).equals(body.optString("address"), true)
                    else it.optInt("tokenId") != body.optInt("tokenId")
                })
                framesCache.clear()
            }
            return JSONObject().put("removed", true)
        }
        require(server == SERVER && path in paths) { "Unsupported turtle API" }
        val connection = URL(server + path).openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15000; connection.readTimeout = 20000
            connection.instanceFollowRedirects = false; connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Origin", "null")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (output.size() <= 2_000_000) {
                    val count = input.read(buffer, 0, minOf(buffer.size, 2_000_001 - output.size()))
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: throw IllegalStateException("Turtle server unavailable")
            require(bytes.size <= 2_000_000) { "Turtle artwork is too large" }
            val result = JSONObject(String(bytes, Charsets.UTF_8))
            if (connection.responseCode !in 200..299) throw IllegalStateException(result.optString("error", "Connection failed"))
            return result
        } finally { connection.disconnect() }
    }

    private fun decode(image: String): Bitmap {
        require(image.length <= 1_500_000) { "Turtle artwork is too large" }
        val bytes = Base64.decode(image.substringAfter(','), Base64.DEFAULT)
        if (image.startsWith("data:image/svg+xml;base64,")) {
            val svg = SVG.getFromString(String(bytes, Charsets.UTF_8))
            // Render once; preserve the original SVG aspect ratio in a square viewport.
            val bitmap = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
            svg.documentWidth = 128f; svg.documentHeight = 128f
            svg.renderToCanvas(Canvas(bitmap))
            return bitmap
        }
        require(image.startsWith("data:image/png;base64,")) { "Unsupported turtle artwork" }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth in 1..4096 && bounds.outHeight in 1..4096) { "Invalid turtle image dimensions" }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalStateException("Invalid turtle image")
    }

    private fun items(): List<JSONObject> {
        val saved = prefs.getString("companions", null)
        if (saved != null) {
            val array = JSONArray(saved)
            return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
        }
        if (!prefs.getBoolean("selected", false)) return emptyList()
        return listOf(JSONObject().put("tokenId", prefs.getInt("tokenId", 0))
            .put("image", prefs.getString("image", "")).put("token", prefs.getString("token", ""))
            .put("name", prefs.getString("name", "Hood Turtle"))
            .put("active", true).put("validUntil", prefs.getLong("validUntil", 0) / 1000.0))
    }
    private fun save(items: List<JSONObject>) {
        prefs.edit().putString("companions", JSONArray(items).toString()).apply()
    }
    private fun valid(data: JSONObject): Boolean {
        val until = data.optDouble("validUntil", 0.0) * 1000
        return data.optBoolean("active") && until > System.currentTimeMillis() &&
            until <= System.currentTimeMillis() + 86_405_000
    }
    fun importTurtle(server: String, token: String, tokenId: Int): JSONObject {
        val ticket = synchronized(lock) { generation }
        val result = request(server, "/api/featured/hood-turtle", JSONObject().put("token", token).put("tokenId", tokenId))
        require(valid(result)) { "Your turtle ownership could not be verified" }
        require(result.optInt("tokenId") == tokenId) { "Unexpected turtle" }
        result.put("token", token)
        synchronized(lock) {
            require(ticket == generation) { "Turtle selection changed. Please retry." }
            val selected = items().filter { it.optInt("tokenId") != tokenId }
            require(selected.size < 5) { "Show up to five companions. Remove one first." }
            save(selected + result)
        }
        return result
    }
    fun all(): List<JSONObject> = synchronized(lock) { items().filter { valid(it) } }
    fun frames(data: JSONObject): List<Bitmap> = synchronized(lock) {
        val art = data.optJSONObject("companion") ?: return@synchronized emptyList()
        if (art.optString("adapter") != "hood-turtles-v1") return@synchronized emptyList()
        val images = art.optJSONArray("frames") ?: return@synchronized emptyList()
        if (images.length() != 4) return@synchronized emptyList()
        val key = images.toString()
        framesCache.getOrPut(key) {
            try { (0 until images.length()).map { decode(images.getString(it)) } }
            catch (_: Exception) { emptyList() }
        }
    }
    fun view(): String = synchronized(lock) {
        val active = all().map { JSONObject(it.toString()).apply { remove("token") } }
        val first = active.firstOrNull() ?: JSONObject().put("active", false)
        JSONObject(first.toString()).put("items", JSONArray(active)).put("selected", selected()).toString()
    }
    fun selected() = synchronized(lock) { items().isNotEmpty() }
    fun bitmap(): Bitmap? = all().firstOrNull()?.let { frames(it).firstOrNull() }
    fun clear() = synchronized(lock) {
        generation++
        prefs.edit().clear().apply(); framesCache.clear()
    }
    fun refreshIfDue() {
        val now = System.currentTimeMillis()
        val expired = synchronized(lock) {
            if (refreshing || now < retryAt) return
            val due = items().filter { !valid(it) || !it.has("companion") }
            if (due.isEmpty()) return
            refreshing = true; retryAt = now + 60_000
            due
        }
        val ticket = synchronized(lock) { generation }
        Thread {
            try {
                for (old in expired) {
                    val result = request(SERVER, "/api/featured/hood-turtle", JSONObject()
                        .put("token", old.optString("token")).put("tokenId", old.optInt("tokenId")))
                    synchronized(lock) {
                        if (ticket == generation) {
                            val remaining = items().filter { it.optInt("tokenId") != old.optInt("tokenId") }
                            if (valid(result)) save(remaining + result.put("token", old.optString("token")))
                            else save(remaining)
                        }
                    }
                }
            } catch (_: Exception) { /* Expired companions remain hidden until verified. */ }
            finally { synchronized(lock) { refreshing = false } }
        }.start()
    }
}
