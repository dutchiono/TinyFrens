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
}
