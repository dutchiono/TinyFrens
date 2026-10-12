package com.example.floatingpet

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.util.Base64
import com.caverock.androidsvg.SVG
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Original NFT artwork, verified by the relay. No wallet keys are stored here. */
class TurtleStore(context: Context) {
    private val prefs = context.getSharedPreferences("hood_turtle", Context.MODE_PRIVATE)
    companion object {
        private val lock = Any()
        private var cachedKey = ""
        private var cachedBitmap: Bitmap? = null
        private var refreshing = false
        private var retryAt = 0L
        private var generation = 0L
        const val SERVER = "https://tinyfrens.miono.live"
        private val paths = setOf("/api/register", "/api/wallet-link/status", "/api/wallet-link/challenge",
            "/api/wallet-link/confirm", "/api/wallet-link/disconnect", "/api/wallet-link/nfts", "/api/featured/hood-turtle",
            "/api/turtle-connect/start", "/api/turtle-connect/status", "/api/turtle-connect/accept")
    }

    fun request(server: String, path: String, body: JSONObject): JSONObject {
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
            val bitmap = Bitmap.createBitmap(320, 320, Bitmap.Config.ARGB_8888)
            svg.documentWidth = 320f; svg.documentHeight = 320f
            svg.renderToCanvas(Canvas(bitmap))
            return bitmap
        }
        require(image.startsWith("data:image/png;base64,")) { "Unsupported turtle artwork" }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth in 1..4096 && bounds.outHeight in 1..4096) { "Invalid turtle image dimensions" }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalStateException("Invalid turtle image")
    }

    fun importTurtle(server: String, token: String, tokenId: Int): JSONObject {
        val ticket = synchronized(lock) { ++generation }
        val result = request(server, "/api/featured/hood-turtle", JSONObject().put("token", token).put("tokenId", tokenId))
        require(result.optBoolean("active")) { "Your wallet no longer owns this turtle" }
        val validUntil = (result.getDouble("validUntil") * 1000).toLong()
        require(validUntil > System.currentTimeMillis() && validUntil <= System.currentTimeMillis() + 86_405_000) { "Turtle verification expired" }
        val image = result.getString("image")
        val bitmap = decode(image)
        synchronized(lock) {
            require(ticket == generation) { "Turtle selection changed. Please retry." }
            prefs.edit().putBoolean("selected", true).putString("image", image).putString("token", token)
                .putInt("tokenId", tokenId).putString("name", result.optString("name")).putLong("validUntil", validUntil).apply()
            cachedKey = image; cachedBitmap = bitmap
        }
        return result
    }

    fun view(): String = synchronized(lock) {
        if (bitmap() == null) return@synchronized "{}"
        JSONObject().put("active", true).put("tokenId", prefs.getInt("tokenId", 0))
            .put("name", prefs.getString("name", "Hood Turtle"))
            .put("image", prefs.getString("image", ""))
            .put("validUntil", prefs.getLong("validUntil", 0) / 1000.0).toString()
    }

    fun selected() = prefs.getBoolean("selected", false)
    fun bitmap(): Bitmap? = synchronized(lock) {
        if (!selected() || System.currentTimeMillis() >= prefs.getLong("validUntil", 0)) return@synchronized null
        val image = prefs.getString("image", "").orEmpty()
        if (image != cachedKey) {
            cachedBitmap = try { decode(image) } catch (_: Exception) { null }
            cachedKey = image
        }
        cachedBitmap
    }

    fun clear() = synchronized(lock) {
        generation++
        prefs.edit().clear().apply(); cachedKey = ""; cachedBitmap = null
    }

    fun refreshIfDue() {
        val now = System.currentTimeMillis()
        synchronized(lock) {
            if (!selected() || refreshing || now < retryAt || now < prefs.getLong("validUntil", 0)) return
            refreshing = true; retryAt = now + 60_000
        }
        val token = prefs.getString("token", "").orEmpty()
        val tokenId = prefs.getInt("tokenId", 0)
        val ticket = synchronized(lock) { generation }
        Thread {
            try {
                val result = request(SERVER, "/api/featured/hood-turtle", JSONObject().put("token", token).put("tokenId", tokenId))
                if (!result.optBoolean("active")) {
                    synchronized(lock) { if (ticket == generation) clear() }
                } else {
                    val image = result.getString("image"); val bitmap = decode(image)
                    synchronized(lock) {
                        if (ticket == generation) {
                            prefs.edit().putString("image", image).putLong("validUntil", (result.getDouble("validUntil") * 1000).toLong()).apply()
                            cachedKey = image; cachedBitmap = bitmap
                        }
                    }
                }
            } catch (_: Exception) { /* Expired artwork stays hidden; retry after one minute. */ }
            finally { synchronized(lock) { refreshing = false } }
        }.start()
    }
}
