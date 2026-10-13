package com.example.floatingpet
import kotlin.math.hypot
object PetMotion {
 data class Step(val x:Float,val y:Float,val arrived:Boolean)
 fun move(x:Float,y:Float,tx:Float,ty:Float,speed:Float,dt:Float,mx:Float,my:Float):Step {
  val a=tx.coerceIn(0f,mx.coerceAtLeast(0f));val b=ty.coerceIn(0f,my.coerceAtLeast(0f))
  val dx=a-x;val dy=b-y;val distance=hypot(dx,dy)
  val step=(speed.coerceAtLeast(0f)*dt.coerceIn(0f,.1f)).coerceAtMost(distance)
  if(distance<.01f)return Step(a,b,true)
  return Step((x+dx/distance*step).coerceIn(0f,mx.coerceAtLeast(0f)),(y+dy/distance*step).coerceIn(0f,my.coerceAtLeast(0f)),step>=distance)
 }
}
object PetBounds {
 fun calculateBounds(
  screenWidth: Float,
  screenHeight: Float,
  petWidth: Float,
  petHeight: Float,
  navBarHeight: Float,
  keyboardHeight: Int,
  bottomPadding: Float = 8f,
  keyboardMargin: Float = 12f
 ): Pair<Float, Float> {
  val maxX = (screenWidth - petWidth).coerceAtLeast(0f)
  val bottomInset = if (keyboardHeight > 0) {
   keyboardHeight.toFloat() + keyboardMargin
  } else {
   navBarHeight.coerceAtLeast(bottomPadding) + bottomPadding
  }
  val maxY = (screenHeight - bottomInset - petHeight).coerceAtLeast(0f)
  return Pair(maxX, maxY)
 }
}
