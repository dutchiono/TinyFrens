package com.example.floatingpet

import android.app.*
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.*
import kotlin.math.roundToInt

class PetOverlayService : Service() {
    companion object { @Volatile var running = false; const val ACTION_HIDE = "com.example.floatingpet.HIDE" }
    private lateinit var manager: WindowManager
    private var pet: PetView? = null
    private var params: WindowManager.LayoutParams? = null
    private val handler = Handler(Looper.getMainLooper())
    private val store by lazy { PetStore(this) }
    private val position by lazy { getSharedPreferences("overlay_position", MODE_PRIVATE) }
    private var tick = 0
    private var previousMode = ""
    private val animator = object : Runnable {
        override fun run() {
            val view = pet ?: return
            val p = params ?: return
            val state = store.read()
            val mode = state.optString("mode", "roam")
            if (mode != previousMode) { view.mode = mode; previousMode = mode }
            view.stage = state.optInt("stage", 0)
            view.mood = when {
                state.optInt("energy") < 20 -> "sleep"
                state.optInt("hunger") < 20 -> "hungry"
                else -> "idle"
            }
            tick++
            view.frame = tick
            if (mode == "roam" && !view.dragging && tick % 3 == 0) {
                val maxX = (resources.displayMetrics.widthPixels - p.width).coerceAtLeast(0)
                p.x = (p.x + view.direction * 3).coerceIn(0, maxX)
                if (p.x == 0 || p.x == maxX) view.direction *= -1
                update(view, p)
            }
            view.invalidate()
            handler.postDelayed(this, 150)
        }
    }
    override fun onCreate() {
        super.onCreate()
        running = true
        manager = getSystemService(WINDOW_SERVICE) as WindowManager
        val notifications = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        notifications.createNotificationChannel(NotificationChannel("pet", "Floating pet", NotificationManager.IMPORTANCE_LOW))
        val launch = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val hide = PendingIntent.getService(this, 1, Intent(this, PetOverlayService::class.java).setAction(ACTION_HIDE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(this, "pet")
            .setContentTitle("Pocket Familiar is here")
            .setContentText("Tap to care for your pet")
            .setSmallIcon(android.R.drawable.btn_star_big_on)
            .setContentIntent(launch).addAction(android.R.drawable.ic_menu_close_clear_cancel, "Hide pet", hide)
            .setOngoing(true).build()
        startForeground(10, notification)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_HIDE || !Settings.canDrawOverlays(this)) {
            stopSelf(); return START_NOT_STICKY
        }
        if (pet == null) createOverlay()
        pet?.invalidate()
        return START_STICKY
    }
    private fun update(view: PetView, p: WindowManager.LayoutParams) {
        try { manager.updateViewLayout(view, p) } catch (_: IllegalArgumentException) {}
    }
    private fun savePosition(p: WindowManager.LayoutParams) {
        position.edit().putInt("x", p.x).putInt("y", p.y).apply()
    }
    private fun createOverlay() {
        val size = (96 * resources.displayMetrics.density).roundToInt()
        val view = PetView(this)
        val p = WindowManager.LayoutParams(size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT)
        p.gravity = Gravity.TOP or Gravity.START
        val maxX = (resources.displayMetrics.widthPixels - size).coerceAtLeast(0)
        val maxY = (resources.displayMetrics.heightPixels - size).coerceAtLeast(0)
        p.x = position.getInt("x", maxX / 2).coerceIn(0, maxX)
        p.y = position.getInt("y", maxY / 3).coerceIn(0, maxY)
        view.onDrag = { dx, dy ->
            p.x = (p.x + dx).coerceIn(0, maxX)
            p.y = (p.y + dy).coerceIn(0, maxY)
            update(view, p)
        }
        view.onDragEnd = { savePosition(p) }
        view.onTap = {
            // Overlay-triggered activity launches can be restricted on newer Android versions.
            // The persistent notification remains a reliable way to open the management UI.
            try {
                startActivity(Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
            } catch (_: Exception) {}
        }
        try {
            manager.addView(view, p)
            pet = view; params = p
            handler.post(animator)
        } catch (_: Exception) { stopSelf() }
    }
    override fun onDestroy() {
        running = false
        handler.removeCallbacks(animator)
        params?.let { savePosition(it) }
        pet?.let { try { manager.removeView(it) } catch (_: Exception) {} }
        pet = null; params = null
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
