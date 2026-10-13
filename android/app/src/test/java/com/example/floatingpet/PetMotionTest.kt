package com.example.floatingpet
import org.junit.Assert.*
import org.junit.Test
class PetMotionTest {
 @Test fun diagonalSpeedDoesNotDouble(){val s=PetMotion.move(0f,0f,100f,100f,100f,.1f,200f,200f);assertEquals(10f,kotlin.math.hypot(s.x,s.y),.001f);assertFalse(s.arrived)}
 @Test fun arrivalDoesNotOvershoot(){val s=PetMotion.move(0f,0f,2f,0f,100f,.1f,100f,100f);assertEquals(2f,s.x,.001f);assertTrue(s.arrived)}
 @Test fun movementCanGoUpAndLeft(){val s=PetMotion.move(50f,50f,0f,0f,100f,.1f,100f,100f);assertTrue(s.x<50);assertTrue(s.y<50)}
 @Test fun targetIsClamped(){val s=PetMotion.move(99f,99f,500f,500f,100f,.1f,100f,100f);assertEquals(100f,s.x,.001f);assertTrue(s.arrived)}
 @Test fun tinyScreenIsSafe(){val s=PetMotion.move(0f,0f,5f,5f,100f,.1f,-20f,-20f);assertEquals(0f,s.x,.001f)}
 @Test fun pausedTimeDoesNotTeleport(){val s=PetMotion.move(0f,0f,100f,0f,100f,40f,200f,200f);assertEquals(10f,s.x,.001f)}
 @Test fun fullscreenBoundsWhenNoKeyboard(){
  val (bx, by) = PetBounds.calculateBounds(1080f, 2400f, 240f, 240f, 144f, 0, 8f, 12f)
  assertEquals(840f, bx, 0.001f)
  assertEquals(2008f, by, 0.001f) // 2400 - (144 + 8) - 240 = 2008
  assertTrue("Roams over 80% screen height", by > 2400f * 0.8f)
 }
 @Test fun keyboardBoundsAvoidance(){
  val (bx, by) = PetBounds.calculateBounds(1080f, 2400f, 240f, 240f, 144f, 800, 8f, 12f)
  assertEquals(840f, bx, 0.001f)
  assertEquals(1348f, by, 0.001f) // 2400 - (800 + 12) - 240 = 1348
  // Verify pet never touches keyboard (keyboard starts at 1600f, pet bottom is at 1348 + 240 = 1588f)
  assertTrue("Bottom of pet stays above keyboard top", by + 240f < (2400f - 800f))
 }
 @Test fun keyboardDismissExpandsBounds(){
  val (_, keyboardBy) = PetBounds.calculateBounds(1080f, 2400f, 240f, 240f, 144f, 800, 8f, 12f)
  val (_, fullBy) = PetBounds.calculateBounds(1080f, 2400f, 240f, 240f, 144f, 0, 8f, 12f)
  assertTrue("Dismissing keyboard expands usable height", fullBy > keyboardBy + 600f)
 }
 @Test fun safeOnTinyScreenOrExtremeKeyboard(){
  val (bx, by) = PetBounds.calculateBounds(200f, 300f, 240f, 240f, 100f, 500, 8f, 12f)
  assertEquals(0f, bx, 0.001f)
  assertEquals(0f, by, 0.001f)
 }
}
