package com.example.floatingpet

import android.content.Context
import org.json.JSONObject
import kotlin.math.max

/** Android is authoritative when the PWA is embedded in the APK. */
class PetStore(context: Context) {
    private val prefs = context.getSharedPreferences("pet", Context.MODE_PRIVATE)
    fun read(): JSONObject {
        val now = System.currentTimeMillis()
        val last = prefs.getLong("last", now).coerceAtMost(now)
        val hours = ((now - last) / 3_600_000L).coerceAtMost(24 * 30)
        val hunger = max(0, prefs.getInt("hunger", 80) - (hours * 3).toInt())
        val happiness = max(0, prefs.getInt("happiness", 80) - (hours * 2).toInt())
        val energy = max(0, prefs.getInt("energy", 80) - hours.toInt())
        prefs.edit().putInt("hunger", hunger).putInt("happiness", happiness)
            .putInt("energy", energy).putLong("last", now).apply()
        return JSONObject().put("hunger", hunger).put("happiness", happiness)
            .put("energy", energy).put("born", prefs.getLong("born", now).also {
                if (!prefs.contains("born")) prefs.edit().putLong("born", it).apply()
            }).put("mode", prefs.getString("mode", "roam"))
            .put("stage", ((now - prefs.getLong("born", now)) / 86_400_000L).coerceIn(0, 2).toInt())
    }
    fun act(action: String): JSONObject {
        val state = read()
        fun adjust(key: String, amount: Int) {
            val value = (state.getInt(key) + amount).coerceIn(0, 100)
            state.put(key, value)
            prefs.edit().putInt(key, value).apply()
        }
        when (action) {
            "feed" -> adjust("hunger", 25)
            "play" -> { adjust("happiness", 20); adjust("energy", -12); adjust("hunger", -8) }
            "rest" -> adjust("energy", 25)
        }
        return state
    }
    fun setMode(mode: String): JSONObject {
        if (mode == "bubble" || mode == "roam") prefs.edit().putString("mode", mode).apply()
        return read()
    }
}
