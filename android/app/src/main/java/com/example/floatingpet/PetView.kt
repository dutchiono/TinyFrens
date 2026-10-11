package com.example.floatingpet

import android.content.Context
import android.graphics.*
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs

/** Transparent 32x32 pixel-art companion, with a genuinely circular bubble mode. */
class PetView(context: Context) : View(context) {
    var onDrag: ((Int, Int) -> Unit)? = null
    var onDragEnd: (() -> Unit)? = null
    var onTap: (() -> Unit)? = null
    var dragging = false
    var frame = 0
    var direction = 1
    var mode = "roam"
    var mood = "idle"
    var stage = 0
    private var downX = 0f; private var downY = 0f
    private var lastX = 0f; private var lastY = 0f
    private val threshold = ViewConfiguration.get(context).scaledTouchSlop
    private val paint = Paint().apply { isAntiAlias = false }
    private fun pixel(c: Canvas, x: Int, y: Int, w: Int, h: Int, color: Int, s: Float) {
        paint.color = color
        c.drawRect(x*s, y*s, (x+w)*s, (y+h)*s, paint)
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val s = width / 32f
        val dark = Color.rgb(75, 45, 119)
        val body = when(stage) {
            0 -> Color.rgb(164, 116, 241)
            1 -> Color.rgb(102, 199, 210)
            else -> Color.rgb(255, 185, 94)
        }
        val blush = Color.rgb(255, 130, 167)
        if (mode == "bubble") {
            paint.isAntiAlias = true
            paint.color = Color.rgb(40, 32, 67)
            canvas.drawCircle(width/2f, height/2f, width*0.48f, paint)
            paint.color = Color.rgb(224, 209, 255)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.5f*s
            canvas.drawCircle(width/2f, height/2f, width*0.45f, paint)
            paint.style = Paint.Style.FILL
            paint.isAntiAlias = false
        }
        val bounce = if (mood == "sleep") 1 else if (frame % 8 < 4) 0 else 1
        pixel(canvas, 9, 9+bounce, 14, 17, dark, s)
        pixel(canvas, 10, 8+bounce, 12, 17, body, s)
        pixel(canvas, 8, 12+bounce, 16, 11, body, s)
        pixel(canvas, 9, 5+bounce, 4, 7, dark, s)
        pixel(canvas, 10, 6+bounce, 2, 5, body, s)
        pixel(canvas, 19, 5+bounce, 4, 7, dark, s)
        pixel(canvas, 20, 6+bounce, 2, 5, body, s)
        if (mood == "sleep") {
            pixel(canvas, 11, 17+bounce, 3, 1, dark, s)
            pixel(canvas, 18, 17+bounce, 3, 1, dark, s)
        } else {
            pixel(canvas, 11, 15+bounce, 3, 4, dark, s)
            pixel(canvas, 18, 15+bounce, 3, 4, dark, s)
        }
        pixel(canvas, 9, 19+bounce, 3, 2, blush, s)
        pixel(canvas, 20, 19+bounce, 3, 2, blush, s)
        pixel(canvas, 15, 20+bounce, 2, 1, dark, s)
        pixel(canvas, 11, 25+bounce, 4, 2, dark, s)
        pixel(canvas, 18, 25+bounce, 4, 2, dark, s)
        if (stage >= 1) {
            pixel(canvas, 7, 11+bounce, 2, 4, body, s)
            pixel(canvas, 23, 11+bounce, 2, 4, body, s)
        }
        if (stage >= 2) {
            pixel(canvas, 15, 3+bounce, 2, 4, dark, s)
            pixel(canvas, 15, 2+bounce, 2, 2, body, s)
        }
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.rawX; downY = event.rawY
                lastX = event.rawX; lastY = event.rawY
                dragging = false; return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (abs(event.rawX-downX) > threshold || abs(event.rawY-downY) > threshold) dragging = true
                if (dragging) onDrag?.invoke((event.rawX-lastX).toInt(), (event.rawY-lastY).toInt())
                lastX = event.rawX; lastY = event.rawY; return true
            }
            MotionEvent.ACTION_UP -> {
                if (dragging) onDragEnd?.invoke() else onTap?.invoke()
                dragging = false; performClick(); return true
            }
            MotionEvent.ACTION_CANCEL -> { dragging = false; return true }
        }
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
}
