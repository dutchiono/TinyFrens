package com.example.floatingpet
import android.content.Context
import android.graphics.*
import android.view.*
import kotlin.math.abs
import kotlin.math.sin
class PetView(context:Context):View(context){
 var onDrag:((Int,Int)->Unit)?=null;var onDragEnd:(()->Unit)?=null;var onTap:(()->Unit)?=null;var onHold:(()->Unit)?=null
 var dragging=false;var frame=0;var direction=1;var mode="roam";var mood="idle";var stage=0;var shape="cat"
 var bodyColor=Color.rgb(164,116,241)
 private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
 private var dx=0f;private var dy=0f;private var lx=0f;private var ly=0f;private var held=false
 private val slop=ViewConfiguration.get(context).scaledTouchSlop
 private val hold=Runnable{if(!dragging){held=true;onHold?.invoke()}}
 private fun rect(c:Canvas,x:Float,y:Float,w:Float,h:Float,color:Int){paint.color=color;c.drawRect(x,y,x+w,y+h,paint)}
 override fun onDraw(c:Canvas){
  super.onDraw(c);c.save();c.scale(width/40f,height/40f)
  val dark=Color.rgb(47,32,69);val phase=frame*.32f
  if(mode=="bubble"){paint.color=Color.rgb(40,32,67);c.drawCircle(20f,20f,19f,paint);paint.color=Color.rgb(224,209,255);paint.style=Paint.Style.STROKE;paint.strokeWidth=1f;c.drawCircle(20f,20f,18f,paint);paint.style=Paint.Style.FILL}
  val bounce=when(mood){"walk"->abs(sin(phase))*1.8f;"dance","happy"->abs(sin(phase))*4;"eat"->sin(phase)*.8f;else->sin(phase*.25f)*.5f}
  c.save();c.translate(0f,-bounce);if(mood=="dance")c.rotate(sin(phase)*12,20f,25f)
  if(mood=="sleep")c.translate(0f,2f)
  paint.color=dark
  when(shape){
   "robot"->{c.drawRoundRect(8f,11f,32f,32f,2f,2f,paint);rect(c,19f,6f,2f,5f,dark);rect(c,17f,4f,6f,3f,bodyColor)}
   "blob"->c.drawRoundRect(7f,12f,33f,33f,12f,12f,paint)
   else->{c.drawRoundRect(8f,13f,32f,32f,6f,6f,paint);rect(c,9f,6f,6f,11f,dark);rect(c,25f,6f,6f,11f,dark);rect(c,10f,8f,4f,8f,bodyColor);rect(c,26f,8f,4f,8f,bodyColor)}
  }
  paint.color=bodyColor;c.drawRoundRect(9f,14f,31f,30f,if(shape=="robot")1f else 7f,if(shape=="robot")1f else 7f,paint)
  val look=direction*.7f
  if(mood=="sleep"||mood=="happy"||frame%100<4){rect(c,13f+look,21f,4f,1f,dark);rect(c,23f+look,21f,4f,1f,dark)}
  else{rect(c,13f+look,18f,4f,5f,dark);rect(c,23f+look,18f,4f,5f,dark);rect(c,14f+look,18f,1f,1f,Color.WHITE);rect(c,24f+look,18f,1f,1f,Color.WHITE)}
  rect(c,11f,24f,4f,2f,Color.rgb(255,130,167));rect(c,25f,24f,4f,2f,Color.rgb(255,130,167));rect(c,19f,26f,2f,if(mood=="eat"&&frame%10<5)3f else 1f,dark)
  val step=if(mood=="walk")sin(phase)*2 else 0f;rect(c,12f,31f+step,5f,3f,dark);rect(c,23f,31f-step,5f,3f,dark)
  if(mood=="wave"||mood=="dance")rect(c,32f,17f+sin(phase)*3,3f,7f,bodyColor)
  if(stage>=1)rect(c,6f,22f,3f,5f,bodyColor);if(stage>=2)rect(c,19f,9f,2f,4f,Color.rgb(255,219,105))
  c.restore()
  if(mood=="eat"){rect(c,17f,30f,6f,5f,Color.rgb(240,80,119));rect(c,19f,28f,2f,2f,Color.GREEN)}
  if(mood in listOf("sleep","happy","dance","wave")){paint.color=Color.WHITE;paint.textSize=6f;paint.typeface=Typeface.DEFAULT_BOLD;c.drawText(when(mood){"sleep"->"zZ";"wave"->"hi!";else->"♥"},26f,8f+sin(phase),paint)}
  c.restore()
 }
 override fun onTouchEvent(e:MotionEvent):Boolean{
  when(e.actionMasked){
   MotionEvent.ACTION_DOWN->{dx=e.rawX;dy=e.rawY;lx=e.rawX;ly=e.rawY;dragging=false;held=false;postDelayed(hold,600)}
   MotionEvent.ACTION_MOVE->{if(abs(e.rawX-dx)>slop||abs(e.rawY-dy)>slop){dragging=true;removeCallbacks(hold)};if(dragging)onDrag?.invoke((e.rawX-lx).toInt(),(e.rawY-ly).toInt());lx=e.rawX;ly=e.rawY}
   MotionEvent.ACTION_UP->{removeCallbacks(hold);if(dragging)onDragEnd?.invoke()else if(!held){onTap?.invoke();performClick()};dragging=false}
   MotionEvent.ACTION_CANCEL->{removeCallbacks(hold);dragging=false}
  };return true
 }
 override fun performClick():Boolean{super.performClick();return true}
 override fun onDetachedFromWindow(){removeCallbacks(hold);super.onDetachedFromWindow()}
}
