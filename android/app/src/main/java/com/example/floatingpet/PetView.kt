package com.example.floatingpet
import android.content.Context
import android.graphics.*
import android.view.*
import kotlin.math.abs
import kotlin.math.sin
class PetView(context:Context):View(context){
 var onDrag:((Int,Int)->Unit)?=null;var onDragEnd:(()->Unit)?=null;var onTap:(()->Unit)?=null;var onHold:(()->Unit)?=null
 var dragging=false;var frame=0;var direction=1;var mode="roam";var mood="idle";var stage=0;var shape="cat"
 var reducedMotion=false
 var bodyColor=Color.rgb(164,116,241)
 private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
 private var dx=0f;private var dy=0f;private var lx=0f;private var ly=0f;private var held=false
 private val slop=ViewConfiguration.get(context).scaledTouchSlop
 private val hold=Runnable{if(!dragging){held=true;onHold?.invoke()}}
 private fun rect(c:Canvas,x:Float,y:Float,w:Float,h:Float,color:Int){paint.shader=null;paint.style=Paint.Style.FILL;paint.color=color;c.drawRect(x,y,x+w,y+h,paint)}
 private fun oval(c:Canvas,x:Float,y:Float,w:Float,h:Float,color:Int){paint.shader=null;paint.style=Paint.Style.FILL;paint.color=color;c.drawOval(x,y,x+w,y+h,paint)}
 private fun strokePath(c:Canvas,path:Path,color:Int,width:Float){paint.shader=null;paint.style=Paint.Style.STROKE;paint.strokeWidth=width;paint.strokeCap=Paint.Cap.ROUND;paint.strokeJoin=Paint.Join.ROUND;paint.color=color;c.drawPath(path,paint);paint.style=Paint.Style.FILL}
 override fun onDraw(c:Canvas){
  super.onDraw(c);c.save();c.scale(width/40f,height/40f)
  val dark=Color.rgb(47,32,69);val phase=if(reducedMotion)0f else frame*.32f
  if(mode=="bubble"){paint.color=Color.rgb(40,32,67);c.drawCircle(20f,20f,19f,paint);paint.color=Color.rgb(224,209,255);paint.style=Paint.Style.STROKE;paint.strokeWidth=1f;c.drawCircle(20f,20f,18f,paint);paint.style=Paint.Style.FILL}
  val bounce=when(mood){"walk"->abs(sin(phase))*1.8f;"dance","happy"->abs(sin(phase))*4;"eat"->sin(phase)*.8f;else->sin(phase*.25f)*.5f}
  val step=if(mood=="walk"||mood=="dance")sin(phase)*2f else 0f
  oval(c,8f,34.2f,24f,3.3f,Color.argb(45,0,0,0))
  c.save();c.translate(0f,-bounce);if(mood=="dance"&&!reducedMotion)c.rotate(sin(phase)*12,20f,25f)
  if(mood=="sleep")c.translate(0f,2f)
  val leftArm=Path().apply{moveTo(8.8f,22f);cubicTo(2f,25f,4f,31f,10f,31f)}
  val rightArm=Path().apply{moveTo(31.2f,22f);cubicTo(38f,25f,36f,31f,30f,31f)}
  strokePath(c,leftArm,dark,3.2f);strokePath(c,rightArm,dark,3.2f)
  oval(c,11.6f,31.2f+step,6f,4.2f,dark);oval(c,22.4f,31.2f-step,6f,4.2f,dark)
  paint.color=dark
  when(shape){
   "robot"->{c.drawRoundRect(8f,10.5f,32f,32f,2.4f,2.4f,paint);rect(c,19f,5.5f,2f,5f,dark);oval(c,17f,3f,6f,4f,bodyColor)}
   "blob"->{}
   "bunny"->{c.drawRoundRect(10.5f,1.5f,16.5f,17f,4f,4f,paint);c.drawRoundRect(23.5f,1.5f,29.5f,17f,4f,4f,paint);rect(c,12f,3f,3f,12f,bodyColor);rect(c,25f,3f,3f,12f,bodyColor)}
   "dog"->{c.save();c.rotate(-24f,8f,15f);c.drawRoundRect(4.5f,12f,11f,26f,4f,5f,paint);c.restore();c.save();c.rotate(24f,32f,15f);c.drawRoundRect(29f,12f,35.5f,26f,4f,5f,paint);c.restore()}
   "bear"->{c.drawCircle(11f,11f,4.2f,paint);c.drawCircle(29f,11f,4.2f,paint)}
   "frog"->{c.drawCircle(12.3f,12.4f,4.4f,paint);c.drawCircle(27.7f,12.4f,4.4f,paint)}
   "turtle"->{}
   else->{val le=Path().apply{moveTo(9f,17f);lineTo(13f,5f);lineTo(17f,17f);close()};val re=Path().apply{moveTo(23f,17f);lineTo(27f,5f);lineTo(31f,17f);close()};c.drawPath(le,paint);c.drawPath(re,paint)}
  }
  paint.shader=LinearGradient(8f,12f,32f,34f,intArrayOf(Color.argb(125,255,255,255),bodyColor,Color.argb(55,0,0,0)),floatArrayOf(0f,.42f,1f),Shader.TileMode.CLAMP)
  val body=Path()
  if(shape=="robot")body.addRoundRect(9f,13f,31f,31.5f,2f,2f,Path.Direction.CW)
  else if(shape=="blob")body.apply{moveTo(9f,16f);cubicTo(4f,23f,7f,34f,16f,34.5f);cubicTo(20f,38f,24f,32.5f,29f,34f);cubicTo(36f,31f,34f,18f,27f,15f);cubicTo(22f,10f,14f,10.5f,9f,16f);close()}
  else body.apply{moveTo(8.5f,18f);cubicTo(8.5f,11.5f,14f,8.8f,20f,9.4f);cubicTo(26f,8.8f,31.5f,11.7f,31.5f,18f);lineTo(31.5f,27.5f);cubicTo(31.5f,34.2f,25.4f,36f,20f,35.2f);cubicTo(14.6f,36f,8.5f,34.2f,8.5f,27.5f);close()}
  paint.style=Paint.Style.FILL;c.drawPath(body,paint);paint.shader=null;strokePath(c,body,dark,2.8f)
  oval(c,13f,13f,9f,6f,Color.argb(80,255,255,255))
  if(shape=="turtle"){paint.style=Paint.Style.STROKE;paint.strokeWidth=1.7f;paint.color=dark;c.drawOval(11f,15.5f,29f,31.5f,paint);c.drawLine(20f,15.5f,20f,31.5f,paint);c.drawLine(12f,23.5f,28f,23.5f,paint);paint.style=Paint.Style.FILL}
  if(shape=="frog"){oval(c,10.8f,11f,3f,3f,Color.WHITE);oval(c,26.2f,11f,3f,3f,Color.WHITE);oval(c,11.7f,11.9f,1.2f,1.2f,dark);oval(c,27.1f,11.9f,1.2f,1.2f,dark)}
  val look=direction*.7f
  if(mood=="sleep"||mood=="happy"||(!reducedMotion&&frame%100<4)){rect(c,13f+look,20.5f,4.4f,1.2f,dark);rect(c,22.6f+look,20.5f,4.4f,1.2f,dark)}
  else{c.drawRoundRect(13f+look,17.6f,17.2f+look,23f,1.3f,1.3f,paint.apply{color=dark});c.drawRoundRect(22.8f+look,17.6f,27f+look,23f,1.3f,1.3f,paint.apply{color=dark});rect(c,14f+look,18.2f,1.1f,1.1f,Color.WHITE);rect(c,23.8f+look,18.2f,1.1f,1.1f,Color.WHITE)}
  oval(c,10.7f,24.4f,4.5f,2.3f,Color.rgb(255,130,167));oval(c,24.8f,24.4f,4.5f,2.3f,Color.rgb(255,130,167));c.drawRoundRect(18.8f,26.3f,21.2f,if(mood=="eat"&&frame%10<5)29.4f else 27.7f,1f,1f,paint.apply{color=dark})
  if(mood=="wave"||mood=="dance"){paint.color=bodyColor;c.drawRoundRect(31.3f,17f+sin(phase)*3,35f,25f+sin(phase)*3,2f,2f,paint);paint.color=dark;paint.style=Paint.Style.STROKE;paint.strokeWidth=1.2f;c.drawRoundRect(31.3f,17f+sin(phase)*3,35f,25f+sin(phase)*3,2f,2f,paint);paint.style=Paint.Style.FILL}
  if(stage>=1){paint.color=bodyColor;c.drawCircle(6.6f,25.5f,2.1f,paint);paint.color=dark;paint.style=Paint.Style.STROKE;paint.strokeWidth=1f;c.drawCircle(6.6f,25.5f,2.1f,paint);paint.style=Paint.Style.FILL};if(stage>=2)rect(c,19f,7.6f,2f,4f,Color.rgb(255,219,105))
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


