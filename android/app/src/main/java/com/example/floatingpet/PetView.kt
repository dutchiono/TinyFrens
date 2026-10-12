package com.example.floatingpet

import android.content.Context
import android.graphics.*
import android.view.*
import kotlin.math.abs
import kotlin.math.sin

class PetView(context: Context) : View(context) {
 var onDrag: ((Int, Int) -> Unit)? = null
 var onDragEnd: (() -> Unit)? = null
 var onTap: (() -> Unit)? = null
 var onHold: (() -> Unit)? = null
 var dragging = false
 var frame = 0
 var direction = 1
 var mode = "roam"
 var mood = "idle"
 var stage = 0
 var shape = "cat"
 var reducedMotion = false
 var bodyColor = Color.rgb(164, 116, 241)
 private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
 private var dx = 0f
 private var dy = 0f
 private var lx = 0f
 private var ly = 0f
 private var held = false
 private val slop = ViewConfiguration.get(context).scaledTouchSlop
 private val hold = Runnable { if (!dragging) { held = true; onHold?.invoke() } }

 private fun rect(c: Canvas, x: Float, y: Float, w: Float, h: Float, color: Int) {
  paint.shader = null; paint.style = Paint.Style.FILL; paint.color = color
  c.drawRect(x, y, x + w, y + h, paint)
 }
 private fun round(c: Canvas, x: Float, y: Float, w: Float, h: Float, r: Float, color: Int) {
  paint.shader = null; paint.style = Paint.Style.FILL; paint.color = color
  c.drawRoundRect(x, y, x + w, y + h, r, r, paint)
 }
 private fun oval(c: Canvas, x: Float, y: Float, w: Float, h: Float, color: Int) {
  paint.shader = null; paint.style = Paint.Style.FILL; paint.color = color
  c.drawOval(x, y, x + w, y + h, paint)
 }
 private fun strokePath(c: Canvas, path: Path, color: Int, width: Float) {
  paint.shader = null; paint.style = Paint.Style.STROKE; paint.strokeWidth = width
  paint.strokeCap = Paint.Cap.ROUND; paint.strokeJoin = Paint.Join.ROUND; paint.color = color
  c.drawPath(path, paint); paint.style = Paint.Style.FILL
 }
 private fun fillPath(c: Canvas, path: Path, color: Int) {
  paint.shader = null; paint.style = Paint.Style.FILL; paint.color = color; c.drawPath(path, paint)
 }
 private fun strokeRound(c: Canvas, x: Float, y: Float, w: Float, h: Float, r: Float, color: Int, width: Float) {
  paint.shader = null; paint.style = Paint.Style.STROKE; paint.strokeWidth = width
  paint.strokeCap = Paint.Cap.ROUND; paint.strokeJoin = Paint.Join.ROUND; paint.color = color
  c.drawRoundRect(x, y, x + w, y + h, r, r, paint); paint.style = Paint.Style.FILL
 }

 override fun onDraw(c: Canvas) {
  super.onDraw(c)
  c.save(); c.scale(width / 40f, height / 40f)
  val dark = Color.rgb(47, 32, 69)
  val pink = Color.rgb(255, 130, 167)
  val phase = if (reducedMotion) 0f else frame * .32f
  if (mode == "bubble") {
   paint.color = Color.rgb(40, 32, 67); c.drawCircle(20f, 20f, 19f, paint)
   paint.color = Color.rgb(224, 209, 255); paint.style = Paint.Style.STROKE; paint.strokeWidth = 1f
   c.drawCircle(20f, 20f, 18f, paint); paint.style = Paint.Style.FILL
  }
  val bounce = when (mood) {
   "walk" -> abs(sin(phase)) * 1.8f
   "dance", "happy" -> abs(sin(phase)) * 4f
   "eat" -> sin(phase) * .8f
   else -> sin(phase * .25f) * .5f
  }
  val step = if (mood == "walk" || mood == "dance") sin(phase) * 2f else 0f
  oval(c, 8f, 34.2f, 24f, 3.3f, Color.argb(45, 0, 0, 0))
  c.save(); c.translate(0f, -bounce)
  if (mood == "dance" && !reducedMotion) c.rotate(sin(phase) * 12, 20f, 25f)
  if (mood == "sleep") c.translate(0f, 2f)

  paint.shader = LinearGradient(
   8f, 9f, 33f, 35f,
   intArrayOf(Color.argb(135, 255, 255, 255), bodyColor, Color.argb(60, 0, 0, 0)),
   floatArrayOf(0f, .42f, 1f),
   Shader.TileMode.CLAMP
  )
  val body = Path()

  when (shape) {
   "robot" -> {
    rect(c, 19f, 4f, 2f, 5f, dark); oval(c, 17.2f, 1.6f, 5.6f, 4.5f, Color.rgb(0, 210, 211))
    round(c, 8.5f, 10f, 23f, 15.5f, 2.8f, bodyColor); strokeRound(c, 8.5f, 10f, 23f, 15.5f, 2.8f, dark, 2.4f)
    round(c, 11.4f, 13f, 17.2f, 9.2f, 1.6f, Color.rgb(245, 251, 255)); strokeRound(c, 11.4f, 13f, 17.2f, 9.2f, 1.6f, dark, 1.4f)
    oval(c, 5.3f, 15.5f, 4.5f, 4.5f, bodyColor); oval(c, 30.2f, 15.5f, 4.5f, 4.5f, bodyColor)
    strokePath(c, Path().apply { moveTo(8.8f, 24f); lineTo(4.8f, 24f); lineTo(4.8f, 29f); lineTo(8.8f, 29f) }, dark, 2.4f)
    strokePath(c, Path().apply { moveTo(31.2f, 24f); lineTo(35.2f, 24f); lineTo(35.2f, 29f); lineTo(31.2f, 29f) }, dark, 2.4f)
    body.addRoundRect(12f, 24f, 28f, 34f, 2.2f, 2.2f, Path.Direction.CW)
   }
   "blob" -> body.apply {
    moveTo(9f, 16f); cubicTo(4.3f, 22.5f, 6.6f, 33.5f, 16f, 34.8f)
    cubicTo(20.2f, 38.2f, 24.4f, 32.7f, 29.2f, 34f); cubicTo(36.5f, 31f, 34.5f, 18f, 27f, 15f)
    cubicTo(22f, 10f, 14f, 10.5f, 9f, 16f); close()
   }
   "bunny" -> {
    val le = Path().apply { moveTo(13.7f, 16.5f); cubicTo(9.4f, 10f, 11f, 2.8f, 14.7f, 1.7f); cubicTo(18.8f, 3.8f, 18.2f, 11.8f, 16.2f, 17.2f); close() }
    val re = Path().apply { moveTo(26.3f, 16.5f); cubicTo(30.6f, 10f, 29f, 2.8f, 25.3f, 1.7f); cubicTo(21.2f, 3.8f, 21.8f, 11.8f, 23.8f, 17.2f); close() }
    fillPath(c, le, bodyColor); strokePath(c, le, dark, 2.2f); fillPath(c, re, bodyColor); strokePath(c, re, dark, 2.2f)
    oval(c, 29.5f, 27.5f, 4.4f, 4.4f, Color.argb(170, 255, 255, 255))
    body.apply { moveTo(10f, 18f); cubicTo(9f, 11.5f, 14.4f, 8.6f, 20f, 9.4f); cubicTo(25.6f, 8.6f, 31f, 11.5f, 30f, 18f); lineTo(28.7f, 28.5f); cubicTo(28f, 34.6f, 23.8f, 36.4f, 20f, 35.3f); cubicTo(16.2f, 36.4f, 12f, 34.6f, 11.3f, 28.5f); close() }
   }
   "duck" -> {
    val crest = Path().apply { moveTo(18.5f, 10f); cubicTo(17f, 3.5f, 21f, 2.5f, 21.5f, 10f); close() }
    fillPath(c, crest, bodyColor); strokePath(c, crest, dark, 2.2f)
    oval(c, 4.5f, 21f, 5.5f, 8f, bodyColor); oval(c, 30f, 21f, 5.5f, 8f, bodyColor)
    body.apply { moveTo(8.5f, 18.5f); cubicTo(8.5f, 11.5f, 14f, 8.8f, 20f, 9.4f); cubicTo(26f, 8.8f, 31.5f, 11.5f, 31.5f, 18.5f); lineTo(31.2f, 27.5f); cubicTo(31f, 34.2f, 25.4f, 36f, 20f, 35.2f); cubicTo(14.6f, 36f, 9f, 34.2f, 8.8f, 27.5f); close() }
   }
   "pig" -> {
    val ple = Path().apply { moveTo(9f, 15f); lineTo(4.5f, 21f); lineTo(10.5f, 20f); close() }
    val pre = Path().apply { moveTo(31f, 15f); lineTo(35.5f, 21f); lineTo(29.5f, 20f); close() }
    fillPath(c, ple, bodyColor); strokePath(c, ple, dark, 2.2f); fillPath(c, pre, bodyColor); strokePath(c, pre, dark, 2.2f)
    strokePath(c, Path().apply { moveTo(30f, 28f); cubicTo(34f, 29f, 34f, 25f, 32f, 25f) }, dark, 2f)
    body.apply { moveTo(8.5f, 18.5f); cubicTo(8.5f, 11.5f, 14f, 8.8f, 20f, 9.4f); cubicTo(26f, 8.8f, 31.5f, 11.5f, 31.5f, 18.5f); lineTo(31.2f, 27.5f); cubicTo(31f, 34.2f, 25.4f, 36f, 20f, 35.2f); cubicTo(14.6f, 36f, 9f, 34.2f, 8.8f, 27.5f); close() }
   }
   "frog" -> {
    oval(c, 8.3f, 8.3f, 7.6f, 7.6f, bodyColor); oval(c, 24.1f, 8.3f, 7.6f, 7.6f, bodyColor)
    strokePath(c, Path().apply { addCircle(12.1f, 12.1f, 3.8f, Path.Direction.CW); addCircle(27.9f, 12.1f, 3.8f, Path.Direction.CW) }, dark, 2.2f)
    body.apply { moveTo(6.7f, 21f); cubicTo(6.7f, 14.5f, 12.5f, 12.3f, 20f, 12.7f); cubicTo(27.5f, 12.3f, 33.3f, 14.5f, 33.3f, 21f); cubicTo(33.3f, 32f, 27f, 35.6f, 20f, 34.5f); cubicTo(13f, 35.6f, 6.7f, 32f, 6.7f, 21f); close() }
   }
      "turtle" -> {
    oval(c, 14f, 8.5f, 12f, 9f, bodyColor); strokeRound(c, 14f, 8.5f, 12f, 9f, 5f, dark, 2.2f)
    strokePath(c, Path().apply { moveTo(8.8f, 23f); lineTo(4.5f, 26f); moveTo(31.2f, 23f); lineTo(35.5f, 26f) }, dark, 2.5f)
    body.addOval(7f, 16f, 33f, 34.5f, Path.Direction.CW)
   }
   else -> {
    val le = Path().apply { moveTo(8.6f, 17f); lineTo(13f, 4.8f); lineTo(17.3f, 17.2f); close() }
    val re = Path().apply { moveTo(22.7f, 17.2f); lineTo(27f, 4.8f); lineTo(31.4f, 17f); close() }
    fillPath(c, le, bodyColor); strokePath(c, le, dark, 2.2f); fillPath(c, re, bodyColor); strokePath(c, re, dark, 2.2f)
    strokePath(c, Path().apply { moveTo(29.3f, 29f); cubicTo(37f, 26.5f, 35f, 19f, 30.2f, 21.7f) }, dark, 2.3f)
    body.apply { moveTo(8.5f, 18f); cubicTo(8.5f, 11.5f, 14f, 8.8f, 20f, 9.4f); cubicTo(26f, 8.8f, 31.5f, 11.7f, 31.5f, 18f); lineTo(31.5f, 27.5f); cubicTo(31.5f, 34.2f, 25.4f, 36f, 20f, 35.2f); cubicTo(14.6f, 36f, 8.5f, 34.2f, 8.5f, 27.5f); close() }
   }
  }

  paint.style = Paint.Style.FILL; c.drawPath(body, paint); paint.shader = null; strokePath(c, body, dark, 2.8f)
  if (shape == "robot") {
   strokeRound(c, 15.2f, 26.8f, 9.6f, 4.8f, 1f, dark, 1.3f); rect(c, 17f, 28.4f, 6f, 1.5f, Color.rgb(0, 210, 211))
  } else oval(c, 13f, 13f, 9f, 6f, Color.argb(80, 255, 255, 255))
  if (shape == "turtle") {
   paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.6f; paint.color = dark
   c.drawOval(10.8f, 18f, 29.2f, 33f, paint); c.drawLine(20f, 18f, 20f, 33f, paint); c.drawLine(11.4f, 25.5f, 28.6f, 25.5f, paint)
   paint.style = Paint.Style.FILL
  }
  if (shape == "frog") {
   oval(c, 13f, 24f, 14f, 8.5f, Color.rgb(200, 247, 197))
  }
  oval(c, 11.4f, 31.2f + step, 6.2f, 4.2f, dark); oval(c, 22.4f, 31.2f - step, 6.2f, 4.2f, dark)
  val look = direction * .7f
  if (mood == "sleep" || mood == "happy" || (!reducedMotion && frame % 100 < 4)) {
   rect(c, 13f + look, 20.5f, 4.4f, 1.2f, dark); rect(c, 22.6f + look, 20.5f, 4.4f, 1.2f, dark)
  } else {
   c.drawRoundRect(13f + look, 17.6f, 17.2f + look, 23f, 1.3f, 1.3f, paint.apply { color = dark })
   c.drawRoundRect(22.8f + look, 17.6f, 27f + look, 23f, 1.3f, 1.3f, paint.apply { color = dark })
   rect(c, 14f + look, 18.2f, 1.1f, 1.1f, Color.WHITE); rect(c, 23.8f + look, 18.2f, 1.1f, 1.1f, Color.WHITE)
  }
  oval(c, 10.7f, 24.4f, 4.5f, 2.3f, pink); oval(c, 24.8f, 24.4f, 4.5f, 2.3f, pink)
  c.drawRoundRect(18.8f, 26.3f, 21.2f, if (mood == "eat" && frame % 10 < 5) 29.4f else 27.7f, 1f, 1f, paint.apply { color = dark })
  if (shape == "duck") {
   oval(c, 16f, 21.8f, 8f, 5f, Color.rgb(255, 159, 67)); strokeRound(c, 16f, 21.8f, 8f, 5f, 2.5f, dark, 1.3f)
   oval(c, 18.5f, 23f, 1f, 1.2f, dark); oval(c, 20.5f, 23f, 1f, 1.2f, dark)
  }
  if (shape == "pig") {
   round(c, 15.5f, 21.5f, 9f, 6.2f, 3f, pink); strokeRound(c, 15.5f, 21.5f, 9f, 6.2f, 3f, dark, 1.4f)
   oval(c, 18f, 23.5f, 1.2f, 2f, dark); oval(c, 21.5f, 23.5f, 1.2f, 2f, dark)
  }
  if (shape == "bunny") { rect(c, 18.2f, 28.2f, 1.5f, 3f, Color.WHITE); rect(c, 20.2f, 28.2f, 1.5f, 3f, Color.WHITE) }
  if (mood == "wave" || mood == "dance") { round(c, 31.3f, 17f + sin(phase) * 3, 3.7f, 8f, 2f, bodyColor); strokeRound(c, 31.3f, 17f + sin(phase) * 3, 3.7f, 8f, 2f, dark, 1.2f) }
  if (stage >= 1) { oval(c, 5.4f, 25.3f, 4.2f, 4.2f, bodyColor); strokePath(c, Path().apply { addCircle(7.5f, 27.4f, 2.1f, Path.Direction.CW) }, dark, 1f) }
  if (stage >= 2) rect(c, 19f, 7.6f, 2f, 4f, Color.rgb(255, 219, 105))
  c.restore()
  if (mood == "eat") { rect(c, 17f, 30f, 6f, 5f, Color.rgb(240, 80, 119)); rect(c, 19f, 28f, 2f, 2f, Color.GREEN) }
  if (mood in listOf("sleep", "happy", "dance", "wave")) {
   paint.color = Color.WHITE; paint.textSize = 6f; paint.typeface = Typeface.DEFAULT_BOLD
   c.drawText(when (mood) { "sleep" -> "zZ"; "wave" -> "hi!"; else -> "<3" }, 26f, 8f + sin(phase), paint)
  }
  c.restore()
 }

 override fun onTouchEvent(e: MotionEvent): Boolean {
  when (e.actionMasked) {
   MotionEvent.ACTION_DOWN -> { dx = e.rawX; dy = e.rawY; lx = e.rawX; ly = e.rawY; dragging = false; held = false; postDelayed(hold, 600) }
   MotionEvent.ACTION_MOVE -> { if (abs(e.rawX - dx) > slop || abs(e.rawY - dy) > slop) { dragging = true; removeCallbacks(hold) }; if (dragging) onDrag?.invoke((e.rawX - lx).toInt(), (e.rawY - ly).toInt()); lx = e.rawX; ly = e.rawY }
   MotionEvent.ACTION_UP -> { removeCallbacks(hold); if (dragging) onDragEnd?.invoke() else if (!held) { onTap?.invoke(); performClick() }; dragging = false }
   MotionEvent.ACTION_CANCEL -> { removeCallbacks(hold); dragging = false }
  }
  return true
 }
 override fun performClick(): Boolean { super.performClick(); return true }
 override fun onDetachedFromWindow() { removeCallbacks(hold); super.onDetachedFromWindow() }
}
