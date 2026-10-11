package com.example.floatingpet
import android.app.*
import android.content.*
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.*
import android.provider.Settings
import android.view.*
import android.widget.*
import kotlin.math.roundToInt
import kotlin.random.Random
class PetOverlayService:Service(){
 companion object{@Volatile var running=false;const val ACTION_HIDE="com.example.floatingpet.HIDE"}
 private lateinit var wm:WindowManager
 private var caption:TextView?=null;private var menuAbove=false
 private var pet:PetView?=null;private var params:WindowManager.LayoutParams?=null;private var menu:View?=null;private var toy:View?=null
 private val handler=Handler(Looper.getMainLooper());private val store by lazy{PetStore(this)}
 private val position by lazy{getSharedPreferences("overlay_position",MODE_PRIVATE)}
 private var state=org.json.JSONObject();private var lastRead=0L;private var frame=0
 private var x=0f;private var y=0f;private var tx=0f;private var ty=0f
 private var nextDecision=0L;private var behavior="walk";private var screenOn=true
 private val closeMenu=Runnable{removeMenu()}
 private val fadeCaption=Runnable{caption?.animate()?.alpha(0f)?.setDuration(600)?.withEndAction{removeCaption()}?.start()}
 private val screenReceiver=object:BroadcastReceiver(){override fun onReceive(c:Context?,i:Intent?){screenOn=i?.action!=Intent.ACTION_SCREEN_OFF}}
 private fun dp(n:Int)=(n*resources.displayMetrics.density).roundToInt()
 private fun bounds():Pair<Float,Float>{
  val b=if(Build.VERSION.SDK_INT>=30)wm.currentWindowMetrics.bounds else null
  return Pair(((b?.width()?:resources.displayMetrics.widthPixels)-(params?.width?:0)).coerceAtLeast(0).toFloat(),
   ((b?.height()?:resources.displayMetrics.heightPixels)-(params?.height?:0)-dp(28)).coerceAtLeast(0).toFloat())
 }
 private fun chooseWalk(){val(bx,by)=bounds();tx=Random.nextFloat()*bx;ty=Random.nextFloat()*by;behavior="walk";nextDecision=SystemClock.elapsedRealtime()+12000}
 private fun clamp(){val(bx,by)=bounds();x=x.coerceIn(0f,bx);y=y.coerceIn(0f,by);params?.let{it.x=x.roundToInt();it.y=y.roundToInt()}}
 private fun update(v:View,p:WindowManager.LayoutParams){try{wm.updateViewLayout(v,p)}catch(_:Exception){if(!Settings.canDrawOverlays(this))stopSelf()}}
 private fun style(){
  val v=pet?:return;val p=params?:return
  v.bodyColor=try{Color.parseColor(state.optString("color","#a474f1"))}catch(_:Exception){Color.rgb(164,116,241)}
  v.shape=state.optString("shape","cat")
  val size=dp(state.optInt("size",80));if(p.width!=size){p.width=size;p.height=size;clamp();update(v,p)}
 }
 private val animator=object:Runnable{override fun run(){
  val v=pet?:return;val p=params?:return
  if(screenOn){
   val now=System.currentTimeMillis();val clock=SystemClock.elapsedRealtime()
   if(now-lastRead>500){state=store.read();lastRead=now;style()}
   v.mode=state.optString("mode","roam");v.stage=state.optInt("stage");v.frame=frame++
   val forced=state.optLong("actionUntil")>now
   if(clock>nextDecision&&!forced&&menu==null){
    if(toy!=null){behavior="walk";nextDecision=clock+12000}
    else if(Random.nextInt(4)==0){behavior=listOf("idle","wave","dance").random();nextDecision=clock+2500}
    else chooseWalk()
   }
   v.mood=when{forced->state.optString("action","idle");state.optInt("energy",80)<15->"sleep";v.dragging||menu!=null->"happy";v.mode=="bubble"->"idle";else->behavior}
   if(v.mode=="roam"&&!v.dragging&&menu==null&&v.mood=="walk"){
    val(bx,by)=bounds();val s=PetMotion.move(x,y,tx,ty,state.optInt("speed",60)*resources.displayMetrics.density,.05f,bx,by)
    v.direction=if(s.x>=x)1 else -1;x=s.x;y=s.y;p.x=x.roundToInt();p.y=y.roundToInt();update(v,p)
    if(s.arrived){behavior="idle";nextDecision=clock+1200;if(toy!=null){removeToy();store.act("play");lastRead=0}}
   };v.invalidate()
  };handler.postDelayed(this,if(screenOn)50 else 1000)
 }}
 override fun onCreate(){
  super.onCreate();running=true;wm=getSystemService(WINDOW_SERVICE) as WindowManager
  registerReceiver(screenReceiver,IntentFilter().apply{addAction(Intent.ACTION_SCREEN_OFF);addAction(Intent.ACTION_SCREEN_ON)})
  val nm=getSystemService(NOTIFICATION_SERVICE) as NotificationManager
  nm.createNotificationChannel(NotificationChannel("pet","Floating pet",NotificationManager.IMPORTANCE_LOW))
  val launch=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  val hide=PendingIntent.getService(this,1,Intent(this,PetOverlayService::class.java).setAction(ACTION_HIDE),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  startForeground(10,Notification.Builder(this,"pet").setContentTitle("TinyFrens is here").setContentText("Tap or hold pet for bubbles · ☰ opens care")
   .setSmallIcon(android.R.drawable.btn_star_big_on).setContentIntent(launch).addAction(android.R.drawable.ic_menu_close_clear_cancel,"Hide pet",hide).setOngoing(true).build())
 }
 override fun onStartCommand(i:Intent?,flags:Int,startId:Int):Int{
  if(i?.action==ACTION_HIDE||!Settings.canDrawOverlays(this)){stopSelf();return START_NOT_STICKY}
  if(pet==null)createOverlay();state=store.read();lastRead=0;style()
  if(i?.getStringExtra("command")=="toy")spawnToy()
  return START_STICKY
 }
 private fun overlay(w:Int,h:Int)=WindowManager.LayoutParams(w,h,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
  WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT).apply{gravity=Gravity.TOP or Gravity.START}
 private fun createOverlay(){
  state=store.read();val size=dp(state.optInt("size",80));val v=PetView(this);val p=overlay(size,size);pet=v;params=p
  val(bx,by)=bounds();x=position.getInt("x",(bx/2).toInt()).toFloat();y=position.getInt("y",(by/3).toInt()).toFloat();clamp()
  v.onDrag={dx,dy->removeMenu();removeCaption();x+=dx;y+=dy;clamp();update(v,p)}
  v.onDragEnd={savePosition();nextDecision=0}
  v.onTap={toggleMenu()}
  v.onHold={toggleMenu()}
  try{wm.addView(v,p);style();chooseWalk();handler.post(animator)}catch(_:Exception){pet=null;params=null;stopSelf()}
 }
 private fun openCare(){removeMenu();removeCaption();try{startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))}catch(_:Exception){}}
 private fun toggleMenu(){
  if(menu!=null){removeMenu();removeCaption()}else{store.act("pet");lastRead=0;showMenu();say("Hey, you!")}
 }
 private fun refreshMenuTimer(){handler.removeCallbacks(closeMenu);handler.postDelayed(closeMenu,8000)}
 private fun showMenu(){
  val panel=LinearLayout(this).apply{
   orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER
   setPadding(dp(4),dp(4),dp(4),dp(4))
  }
  val actions=listOf(Triple("🍓","feed","Feed · hold for wave"),Triple("🎾","play","Play · hold for toy"),Triple("☾","rest","Sleep"),Triple("☰","care","Open full app"))
  for((icon,action,label)in actions){
   val circle=Button(this).apply{
    text=icon;textSize=21f;gravity=Gravity.CENTER;setTextColor(Color.WHITE)
    setPadding(0,0,0,0);minWidth=0;minHeight=0;minimumWidth=0;minimumHeight=0
    contentDescription=label
    background=android.graphics.drawable.StateListDrawable().apply{
     fun disc(color:Int)=GradientDrawable().apply{shape=GradientDrawable.OVAL;setColor(color);setStroke(dp(1),Color.rgb(183,153,235))}
     addState(intArrayOf(android.R.attr.state_pressed),disc(Color.rgb(115,77,172)))
     addState(intArrayOf(),disc(if(action=="care")Color.rgb(65,51,87)else Color.rgb(40,32,67)))
    }
    elevation=dp(3).toFloat()
    setOnTouchListener{_,event->if(event.actionMasked==MotionEvent.ACTION_DOWN){say(label);refreshMenuTimer()};false}
    setOnHoverListener{_,event->if(event.actionMasked==MotionEvent.ACTION_HOVER_ENTER){say(label);refreshMenuTimer()};false}
    setOnClickListener{
     if(action=="care")openCare()
     else{store.act(action);lastRead=0;refreshMenuTimer();say(when(action){"feed"->"Yum! Thanks."; "play"->"Let's dance!";else->"Nap time…"})}
    }
    setOnLongClickListener{
     when(action){
      "feed"->{store.act("wave");lastRead=0;say("Hi there!")}
      "play"->{spawnToy();say("Catch the toy!")}
      "care"->openCare()
      else->{store.act("rest");lastRead=0;say("Sweet dreams…")}
     };refreshMenuTimer();true
    }
   }
   panel.addView(circle,LinearLayout.LayoutParams(dp(48),dp(48)).apply{setMargins(dp(3),0,dp(3),0)})
  }
  val p=overlay(dp(224),dp(56));val(bx,by)=bounds();val pw=params?.width?:dp(80);val ph=params?.height?:dp(80)
  val screenWidth=(bx+pw).toInt();val screenHeight=(by+ph).toInt()
  p.x=(x+pw/2f-p.width/2f).toInt().coerceIn(0,(screenWidth-p.width).coerceAtLeast(0))
  menuAbove=y+ph+p.height>screenHeight
  p.y=(if(menuAbove)y-p.height else y+ph-dp(6)).toInt().coerceIn(0,(screenHeight-p.height).coerceAtLeast(0))
  try{wm.addView(panel,p);menu=panel;refreshMenuTimer()}catch(_:Exception){}
 }
 private fun say(text:String){
  removeCaption()
  val label=TextView(this).apply{
   this.text=text;textSize=13f;setTextColor(Color.WHITE);gravity=Gravity.CENTER;setPadding(dp(10),dp(4),dp(10),dp(4))
   background=GradientDrawable().apply{setColor(Color.argb(220,35,28,54));cornerRadius=dp(12).toFloat()}
   importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_YES;accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE
  }
  val p=overlay(dp(224),dp(36));p.flags=p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
  val(bx,by)=bounds();val pw=params?.width?:dp(80);val ph=params?.height?:dp(80)
  p.x=(x+pw/2f-p.width/2f).toInt().coerceIn(0,((bx+pw).toInt()-p.width).coerceAtLeast(0))
  p.y=(y-dp(if(menuAbove)98 else 40)).toInt().coerceIn(0,((by+ph).toInt()-p.height).coerceAtLeast(0))
  try{wm.addView(label,p);caption=label;label.alpha=0f;label.animate().alpha(1f).setDuration(160).start();handler.postDelayed(fadeCaption,1800)}catch(_:Exception){}
 }
 private fun removeCaption(){handler.removeCallbacks(fadeCaption);caption?.let{it.animate().cancel();try{wm.removeView(it)}catch(_:Exception){}};caption=null}
 private fun removeMenu(){handler.removeCallbacks(closeMenu);menu?.let{try{wm.removeView(it)}catch(_:Exception){}};menu=null;menuAbove=false;removeCaption()}
 private fun removeToy(){toy?.let{try{wm.removeView(it)}catch(_:Exception){}};toy=null}
 private fun spawnToy(){
  removeToy();store.setMode("roam");lastRead=0;val(bx,by)=bounds();tx=Random.nextFloat()*bx;ty=Random.nextFloat()*by
  val ball=TextView(this).apply{text="●";textSize=28f;setTextColor(Color.rgb(130,235,161));gravity=Gravity.CENTER;setOnClickListener{spawnToy()}}
  val p=overlay(dp(36),dp(36));p.x=(tx+dp(22)).toInt();p.y=(ty+dp(22)).toInt()
  try{wm.addView(ball,p);toy=ball;behavior="walk";nextDecision=SystemClock.elapsedRealtime()+12000}catch(_:Exception){}
 }
 private fun savePosition(){position.edit().putInt("x",x.toInt()).putInt("y",y.toInt()).apply()}
 override fun onConfigurationChanged(c:Configuration){super.onConfigurationChanged(c);removeMenu();removeToy();clamp();pet?.let{v->params?.let{p->update(v,p)}};nextDecision=0}
 override fun onDestroy(){running=false;handler.removeCallbacksAndMessages(null);try{unregisterReceiver(screenReceiver)}catch(_:Exception){};savePosition();removeMenu();removeToy();pet?.let{try{wm.removeView(it)}catch(_:Exception){}};pet=null;params=null;super.onDestroy()}
 override fun onBind(i:Intent?):IBinder?=null
}
