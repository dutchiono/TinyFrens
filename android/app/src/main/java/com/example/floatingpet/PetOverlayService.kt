package com.example.floatingpet
import android.app.*
import android.content.*
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.*
import android.provider.Settings
import android.view.*
import android.widget.*
import kotlin.math.roundToInt
import kotlin.random.Random
class PetOverlayService:Service(){
 companion object{
  @Volatile var running=false
  const val ACTION_HIDE="com.example.floatingpet.HIDE"
  const val ACTION_SET_GUESTS="com.example.floatingpet.SET_GUESTS"
  private const val CHAT_SERVER="https://tinyfrens.miono.live"
 }
 class GuestPet(val view:PetView,val params:WindowManager.LayoutParams,var name:String,var shape:String,var color:Int,var tokenId:Int){
  var x=0f;var y=0f;var tx=0f;var ty=0f;var nextMove=0L;var direction=1
 }
 private val guestPets=mutableListOf<GuestPet>()
 private lateinit var wm:WindowManager
 private var closeButton:View?=null;private var caption:TextView?=null;private var menuAbove=false
 private var pet:PetView?=null;private var params:WindowManager.LayoutParams?=null;private var menu:View?=null;private var chatPanel:View?=null;private var toy:View?=null
 private val handler=Handler(Looper.getMainLooper());private val store by lazy{PetStore(this)}
 private val position by lazy{getSharedPreferences("overlay_position",MODE_PRIVATE)}
 private var state=org.json.JSONObject();private var lastRead=0L;private var frame=0
 private var x=0f;private var y=0f;private var tx=0f;private var ty=0f
 private var effectsView:View?=null;private var lastEffectToken=0L;private var hiding=false
 private var nextDecision=0L;private var behavior="walk";private var screenOn=true
 private var updateChecking=false
 private val closeMenu=Runnable{removeMenu()}
 private val fadeCaption=Runnable{caption?.animate()?.alpha(0f)?.setDuration(600)?.withEndAction{removeCaption()}?.start()}
 private val updateCheck=object:Runnable{override fun run(){checkForUpdate();handler.postDelayed(this,15*60*1000)}}
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
 private fun reducedMotion()=state.optBoolean("reduceMotion")||Settings.Global.getFloat(contentResolver,Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f
 private fun hideWithFade(){
  if(hiding)return;hiding=true;removeMenu();removeChat();removeToy();removeEffects();clearGuests()
  val v=pet
  if(v!=null&&state.optBoolean("fade",true)&&!reducedMotion())v.animate().alpha(0f).setDuration(220).withEndAction{stopSelf()}.start()else stopSelf()
 }
 private fun removeEffects(){effectsView?.let{try{wm.removeView(it)}catch(_:Exception){}};effectsView=null}
 private fun careEffect(){
  if(reducedMotion()||(!state.optBoolean("sparkles",true)&&!state.optBoolean("screenEffects",true)))return
  removeEffects()
  val started=SystemClock.elapsedRealtime();val sparkle=state.optBoolean("sparkles",true);val glow=state.optBoolean("screenEffects",true)
  val view=object:View(this@PetOverlayService){
   private val paint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
   override fun onDraw(canvas:android.graphics.Canvas){
    val progress=((SystemClock.elapsedRealtime()-started)/900f).coerceIn(0f,1f);val cx=width/2f;val cy=height/2f
    if(glow){paint.color=Color.argb(((1-progress)*70).toInt(),210,180,240);canvas.drawCircle(cx,cy,dp(32)*(1+progress),paint)}
    if(sparkle)for(n in 0..7){val angle=n*Math.PI/4;val distance=dp(22)+progress*dp(70);val px=cx+kotlin.math.cos(angle).toFloat()*distance;val py=cy+kotlin.math.sin(angle).toFloat()*distance;paint.color=Color.argb(((1-progress)*255).toInt(),240,210,255);paint.strokeWidth=dp(2).toFloat();canvas.drawLine(px-dp(3),py,px+dp(3),py,paint);canvas.drawLine(px,py-dp(3),px,py+dp(3),paint)}
    if(progress<1)postInvalidateOnAnimation()
   }
  }
  val p=overlay(dp(240),dp(240));p.flags=p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;p.alpha=.5f;p.x=(x+(params?.width?:dp(80))/2-p.width/2).toInt();p.y=(y+(params?.height?:dp(80))/2-p.height/2).toInt()
  try{wm.addView(view,p);effectsView=view;handler.postDelayed({if(effectsView===view)removeEffects()},1000)}catch(_:Exception){}
 }
 private fun style(){
  val v=pet?:return;val p=params?:return
  v.bodyColor=try{Color.parseColor(state.optString("color","#a474f1"))}catch(_:Exception){Color.rgb(164,116,241)}
  v.shape=state.optString("shape","cat");v.reducedMotion=reducedMotion()
  if(!hiding)v.alpha=state.optInt("opacity",100).coerceIn(40,100)/100f
  val token=state.optLong("actionUntil");if(token!=lastEffectToken){lastEffectToken=token;if(token>System.currentTimeMillis())careEffect()}
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
   if(v.mode=="roam"&&!reducedMotion()&&!v.dragging&&menu==null&&v.mood=="walk"){
    val(bx,by)=bounds();val s=PetMotion.move(x,y,tx,ty,state.optInt("speed",60)*resources.displayMetrics.density,.05f,bx,by)
    v.direction=if(s.x>=x)1 else -1;x=s.x;y=s.y;p.x=x.roundToInt();p.y=y.roundToInt();update(v,p)
    if(s.arrived){behavior="idle";nextDecision=clock+1200;if(toy!=null){removeToy();lastRead=0}}
   };v.invalidate()
   if(!reducedMotion()&&guestPets.isNotEmpty()){
    val(bx,by)=bounds()
    for(g in guestPets){
     if(clock>g.nextMove){
      g.tx=Random.nextFloat()*bx;g.ty=Random.nextFloat()*by
      g.nextMove=clock+Random.nextLong(3000,7000)
      g.view.mood=if(Random.nextInt(3)==0)"wave" else "walk"
     }
     if(g.view.mood=="walk"){
      val s=PetMotion.move(g.x,g.y,g.tx,g.ty,45f*resources.displayMetrics.density,.05f,bx,by)
      g.direction=if(s.x>=g.x)1 else -1;g.view.direction=g.direction
      g.x=s.x;g.y=s.y;g.params.x=g.x.roundToInt();g.params.y=g.y.roundToInt()
      update(g.view,g.params)
      if(s.arrived){g.view.mood="idle";g.nextMove=clock+1500}
     }
     g.view.invalidate()
    }
   }
  };handler.postDelayed(this,if(screenOn)50 else 1000)
 }}
 override fun onCreate(){
  super.onCreate();running=true;wm=getSystemService(WINDOW_SERVICE) as WindowManager
  registerReceiver(screenReceiver,IntentFilter().apply{addAction(Intent.ACTION_SCREEN_OFF);addAction(Intent.ACTION_SCREEN_ON)})
  val nm=getSystemService(NOTIFICATION_SERVICE) as NotificationManager
  nm.createNotificationChannel(NotificationChannel("pet","Floating pet",NotificationManager.IMPORTANCE_LOW))
  nm.createNotificationChannel(NotificationChannel("updates","TinyFrens updates",NotificationManager.IMPORTANCE_DEFAULT))
  val launch=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  val hide=PendingIntent.getService(this,1,Intent(this,PetOverlayService::class.java).setAction(ACTION_HIDE),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  startForeground(10,Notification.Builder(this,"pet").setContentTitle("TinyFrens is here").setContentText("Tap or hold pet for bubbles · ☰ opens care")
   .setSmallIcon(android.R.drawable.btn_star_big_on).setContentIntent(launch).addAction(android.R.drawable.ic_menu_close_clear_cancel,"Hide pet",hide).setOngoing(true).build())
  handler.postDelayed(updateCheck,30000)
 }
 override fun onStartCommand(i:Intent?,flags:Int,startId:Int):Int{
  if(i?.action==ACTION_HIDE){hideWithFade();return START_NOT_STICKY}
  if(!Settings.canDrawOverlays(this)){stopSelf();return START_NOT_STICKY}
  if(pet==null)createOverlay();state=store.read();lastRead=0;style()
  if(i?.action==ACTION_SET_GUESTS){updateGuests(i.getStringExtra("guests")?:"[]");return START_STICKY}
  if(i?.getStringExtra("command")=="toy")spawnToy()
  return START_STICKY
 }
 private fun removeGuest(g:GuestPet){try{wm.removeView(g.view)}catch(_:Exception){}}
 private fun clearGuests(){for(g in guestPets)removeGuest(g);guestPets.clear()}
 private fun updateGuests(jsonStr:String){
  if(pet==null)return
  val arr=try{org.json.JSONArray(jsonStr)}catch(_:Exception){org.json.JSONArray()}
  val maxCount=arr.length().coerceAtMost(2)
  while(guestPets.size>maxCount){val g=guestPets.removeAt(guestPets.size-1);removeGuest(g)}
  val(bx,by)=bounds()
  for(idx in 0 until maxCount){
   val obj=arr.optJSONObject(idx)?:continue
   val name=obj.optString("name","A fren")
   val shape=obj.optString("shape","cat")
   val color=try{Color.parseColor(obj.optString("color","#a474f1"))}catch(_:Exception){Color.rgb(164,116,241)}
   val tokenId=obj.optInt("tokenId",0)
   if(idx<guestPets.size){
    val g=guestPets[idx]
    g.name=name;g.shape=shape;g.color=color;g.tokenId=tokenId
    g.view.shape=shape;g.view.bodyColor=color;g.view.invalidate()
   }else{
    val gv=PetView(this);val size=dp(64)
    val gp=overlay(size,size)
    gv.shape=shape;gv.bodyColor=color;gv.alpha=0.9f
    val gx=(x+(if(idx==0)-dp(70) else dp(70))).coerceIn(0f,bx)
    val gy=(y+dp(20)).coerceIn(0f,by)
    gp.x=gx.roundToInt();gp.y=gy.roundToInt()
    val guest=GuestPet(gv,gp,name,shape,color,tokenId).apply{x=gx;y=gy;tx=gx;ty=gy;nextMove=SystemClock.elapsedRealtime()+2000}
    gv.onTap={
     val tokenText=if(guest.tokenId>0)" (#${guest.tokenId})" else ""
     say("${guest.name}$tokenText visiting from Plaza!")
    }
    try{wm.addView(gv,gp);guestPets.add(guest)}catch(_:Exception){}
   }
  }
 }
 private fun overlay(w:Int,h:Int)=WindowManager.LayoutParams(w,h,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
  WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT).apply{gravity=Gravity.TOP or Gravity.START}
 private fun chatOverlay(w:Int,h:Int)=WindowManager.LayoutParams(w,h,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
  WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT).apply{gravity=Gravity.TOP or Gravity.START;softInputMode=WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE}
 private fun createOverlay(){
  state=store.read();val size=dp(state.optInt("size",80));val v=PetView(this);val p=overlay(size,size);pet=v;params=p
  val(bx,by)=bounds();x=position.getInt("x",(bx/2).toInt()).toFloat();y=position.getInt("y",(by/3).toInt()).toFloat();clamp()
  v.onDrag={dx,dy->removeMenu();removeCaption();x+=dx;y+=dy;clamp();update(v,p)}
  v.onDragEnd={savePosition();nextDecision=0}
  v.onTap={toggleMenu()}
  v.onHold={toggleMenu()}
  v.setOnHoverListener{_,event->if(event.actionMasked==MotionEvent.ACTION_HOVER_ENTER&&menu==null){showMenu();say("Hey, you!")};false}
  try{wm.addView(v,p);lastEffectToken=state.optLong("actionUntil");style();if(state.optBoolean("fade",true)&&!reducedMotion()){val opacity=v.alpha;v.alpha=0f;v.animate().alpha(opacity).setDuration(220).start()};chooseWalk();handler.post(animator)}catch(_:Exception){pet=null;params=null;stopSelf()}
 }
 private fun openCare(){removeMenu();removeChat();removeCaption();try{startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))}catch(_:Exception){}}
 private fun toggleMenu(){
  if(state.optBoolean("haptics",true))pet?.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
  playPetSound("menu")
  if(menu!=null){removeMenu();removeCaption()}else{showMenu();say("Hey, you!")}
 }
 private fun refreshMenuTimer(){handler.removeCallbacks(closeMenu);handler.postDelayed(closeMenu,8000)}
 private fun showMenu(){
  val panel=LinearLayout(this).apply{
   orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER
   setPadding(dp(4),dp(4),dp(4),dp(4))
  }
  val actions=mutableListOf(Triple("🍓","feed","Feed"),Triple("🎾","play","Play"),Triple("☾","rest","Nap"))
  if(state.optInt("poops",0)>0)actions.add(Triple("🧼","clean","Clean"))
  if(state.optBoolean("sick",false))actions.add(Triple("💊","vitamin","Vitamin"))
  actions.add(Triple("💬","chat","Chat"));actions.add(Triple("☰","care","More"))
  val compact=actions.size>5
  val cellW=dp(if(actions.size>=7)44 else if(compact)50 else 56)
  val circleSize=cellW-dp(8)
  val labelW=cellW-dp(2)
  for((icon,action,label)in actions){
   val circle=Button(this).apply{
    text=icon;textSize=if(compact)18f else 21f;gravity=Gravity.CENTER;setTextColor(Color.WHITE)
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
     else if(action=="chat")showChat()
     else{val result=store.act(action);if(!result.optBoolean("blocked")){if(result.optBoolean("haptics",true))performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);playPetSound(action)};lastRead=0;refreshMenuTimer();say(result.optString("feedback","Done!"))}
    }

   }
   val cell=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER}
   cell.addView(circle,LinearLayout.LayoutParams(circleSize,circleSize))
   cell.addView(TextView(this).apply{text=label;textSize=if(compact)10f else 11f;setTextColor(Color.WHITE);gravity=Gravity.CENTER;background=GradientDrawable().apply{setColor(Color.argb(220,35,28,54));cornerRadius=dp(6).toFloat()};setPadding(dp(4),dp(2),dp(4),dp(2))},LinearLayout.LayoutParams(labelW,dp(22)))
   panel.addView(cell,LinearLayout.LayoutParams(cellW,dp(70)).apply{setMargins(dp(1),0,dp(1),0)})
  }
  val p=overlay(actions.size*cellW+dp(8),dp(78));val(bx,by)=bounds();val pw=params?.width?:dp(80);val ph=params?.height?:dp(80)
  val screenWidth=(bx+pw).toInt();val screenHeight=(by+ph).toInt()
  p.x=(x+pw/2f-p.width/2f).toInt().coerceIn(0,(screenWidth-p.width).coerceAtLeast(0))
  menuAbove=y+ph+p.height>screenHeight
  p.y=(if(menuAbove)y-p.height else y+ph-dp(6)).toInt().coerceIn(0,(screenHeight-p.height).coerceAtLeast(0))
  try{wm.addView(panel,p);menu=panel;showCloseButton();refreshMenuTimer()}catch(_:Exception){}
 }
 private fun showCloseButton(){
  removeCloseButton()
  val button=Button(this).apply{
   text="×";textSize=24f;gravity=Gravity.CENTER;setTextColor(Color.WHITE);contentDescription="Hide pet"
   setPadding(0,0,0,0);minWidth=0;minHeight=0;minimumWidth=0;minimumHeight=0
   background=GradientDrawable().apply{shape=GradientDrawable.OVAL;setColor(Color.rgb(65,51,87));setStroke(dp(1),Color.rgb(183,153,235))}
   setOnClickListener{hideWithFade()}
   setOnHoverListener{_,event->if(event.actionMasked==MotionEvent.ACTION_HOVER_ENTER){say("Hide pet");refreshMenuTimer()};false}
  }
  val p=overlay(dp(48),dp(48));val(bx,by)=bounds();val pw=params?.width?:dp(80);val ph=params?.height?:dp(80)
  p.x=(x+pw-dp(12)).toInt().coerceIn(0,((bx+pw).toInt()-p.width).coerceAtLeast(0))
  p.y=(y-dp(24)).toInt().coerceIn(0,((by+ph).toInt()-p.height).coerceAtLeast(0))
  try{wm.addView(button,p);closeButton=button}catch(_:Exception){}
 }
 private fun removeCloseButton(){closeButton?.let{try{wm.removeView(it)}catch(_:Exception){}};closeButton=null}
 private fun say(text:String,duration:Long=1800,tall:Boolean=false){
  removeCaption()
  val label=TextView(this).apply{
   this.text=text;textSize=13f;setTextColor(Color.WHITE);gravity=Gravity.CENTER;setPadding(dp(10),dp(4),dp(10),dp(4))
   maxLines=if(tall)4 else 1
   background=GradientDrawable().apply{setColor(Color.argb(220,35,28,54));cornerRadius=dp(12).toFloat()}
   importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_YES;accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE
  }
  val p=overlay(if(tall)dp(288)else dp(224),if(tall)dp(92)else dp(36));p.flags=p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
  val(bx,by)=bounds();val pw=params?.width?:dp(80);val ph=params?.height?:dp(80)
  p.x=(x+pw/2f-p.width/2f).toInt().coerceIn(0,((bx+pw).toInt()-p.width).coerceAtLeast(0))
  p.y=(y-dp(if(menuAbove)120 else 40)).toInt().coerceIn(0,((by+ph).toInt()-p.height).coerceAtLeast(0))
  try{wm.addView(label,p);caption=label;label.alpha=0f;label.animate().alpha(1f).setDuration(160).start();handler.postDelayed(fadeCaption,duration)}catch(_:Exception){}
 }
 private fun removeCaption(){handler.removeCallbacks(fadeCaption);caption?.let{it.animate().cancel();try{wm.removeView(it)}catch(_:Exception){}};caption=null}
 private fun playPetSound(name:String){
  if(!store.read().optBoolean("sounds",true))return
  val tone=when(name){"rest","sleep"->ToneGenerator.TONE_PROP_BEEP;"play","dance","toy"->ToneGenerator.TONE_PROP_ACK;"feed","eat"->ToneGenerator.TONE_PROP_BEEP2;else->ToneGenerator.TONE_PROP_PROMPT}
  try{val player=ToneGenerator(AudioManager.STREAM_MUSIC,45);player.startTone(tone,120);handler.postDelayed({try{player.release()}catch(_:Exception){}},180)}catch(_:Exception){}
 }
 private fun showChat(){
  removeMenu();removeCaption();removeChat()
  val status=TextView(this).apply{text="Ask your fren.";textSize=12f;setTextColor(Color.rgb(70,62,82))}
  val input=EditText(this).apply{hint="Say something";setSingleLine(true);textSize=16f;filters=arrayOf(android.text.InputFilter.LengthFilter(220))}
  val send=Button(this).apply{text="Send";minHeight=0;minimumHeight=0}
  val cancel=Button(this).apply{text="×";minWidth=0;minimumWidth=0;contentDescription="Close chat"}
  val row=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL;addView(input,LinearLayout.LayoutParams(0,dp(48),1f));addView(send,LinearLayout.LayoutParams(dp(76),dp(48)).apply{setMargins(dp(8),0,0,0)})}
  val panel=LinearLayout(this).apply{
   orientation=LinearLayout.VERTICAL;setPadding(dp(12),dp(10),dp(12),dp(10))
   background=GradientDrawable().apply{setColor(Color.rgb(255,252,245));cornerRadius=dp(16).toFloat();setStroke(dp(1),Color.rgb(74,45,119))}
   addView(LinearLayout(this@PetOverlayService).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL;addView(TextView(this@PetOverlayService).apply{text="Talk to your fren";textSize=14f;setTextColor(Color.rgb(37,35,38));setTypeface(null,android.graphics.Typeface.BOLD)},LinearLayout.LayoutParams(0,dp(32),1f));addView(cancel,LinearLayout.LayoutParams(dp(38),dp(38)))})
   addView(row);addView(status,LinearLayout.LayoutParams(-1,dp(28)))
  }
  cancel.setOnClickListener{removeChat();say("Later!")}
  send.setOnClickListener{askChat(input.text.toString(),status,send)}
  val(bx,by)=bounds();val pw=params?.width?:dp(80);val ph=params?.height?:dp(80);val screenWidth=(bx+pw).toInt();val screenHeight=(by+ph).toInt()
  val width=minOf(dp(328),(screenWidth-dp(8)).coerceAtLeast(dp(260)))
  val p=chatOverlay(width,dp(160));p.x=(x+pw/2f-width/2f).toInt().coerceIn(0,(screenWidth-width).coerceAtLeast(0));p.y=(y+ph+dp(8)).toInt().coerceIn(0,(screenHeight-p.height).coerceAtLeast(0))
  try{wm.addView(panel,p);chatPanel=panel;input.requestFocus();(getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).showSoftInput(input,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)}catch(_:Exception){}
 }
 private fun askChat(message:String,status:TextView,send:Button){
  val clean=message.replace(Regex("\\p{Cntrl}"),"").replace(Regex("\\s+")," ").trim()
  if(clean.isEmpty()){status.text="Say a little something first.";return}
  status.text="Thinking...";send.isEnabled=false
  val snapshot=store.read()
  Thread{
   var reply="Pet chat is having trouble right now."
   try{
    val shape=snapshot.optString("shape","cat").let{if(it in listOf("cat","blob","robot","bunny","dog","bear","frog","turtle"))it else "cat"}
    val color=snapshot.optString("color","#a474f1").let{if(it.matches(Regex("#[0-9a-fA-F]{6}")))it else "#a474f1"}
    val name=snapshot.optString("name","").ifBlank{"Mochi"}
    val payload=org.json.JSONObject().put("message",clean).put("pet",org.json.JSONObject().put("name",name).put("shape",shape).put("color",color)).toString().toByteArray(Charsets.UTF_8)
    val connection=java.net.URL("$CHAT_SERVER/api/chat").openConnection() as javax.net.ssl.HttpsURLConnection
    try{
     connection.requestMethod="POST";connection.connectTimeout=15000;connection.readTimeout=25000;connection.doOutput=true;connection.instanceFollowRedirects=false
     connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Origin","null")
     connection.outputStream.use{it.write(payload)}
     val stream=if(connection.responseCode in 200..299)connection.inputStream else connection.errorStream
     val bytes=stream?.use{input->val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(1024);while(output.size()<=4096){val count=input.read(buffer,0,minOf(buffer.size,4097-output.size()));if(count<0)break;output.write(buffer,0,count)};output.toByteArray()}?:ByteArray(0)
     val json=org.json.JSONObject(String(bytes,Charsets.UTF_8));reply=json.optString("reply",json.optString("error",reply)).ifBlank{reply}
    }finally{connection.disconnect()}
   }catch(_:Exception){}
   handler.post{removeChat();say(reply,5200,true)}
  }.start()
 }
 private fun removeChat(){chatPanel?.let{try{wm.removeView(it)}catch(_:Exception){}};chatPanel=null}
 private fun checkForUpdate(){
  if(updateChecking||BuildConfig.UPDATE_REPO.isBlank())return
  updateChecking=true
  Thread{
   try{
    val result=UpdateChecker.check(BuildConfig.UPDATE_REPO,BuildConfig.VERSION_CODE)
    if(result.optBoolean("available"))notifyUpdate(result)
   }finally{updateChecking=false}
  }.start()
 }
 private fun notifyUpdate(result:org.json.JSONObject){
  val token=result.optString("sha256",result.optString("url"));if(token.isBlank())return
  val prefs=getSharedPreferences("updates",MODE_PRIVATE);if(prefs.getString("lastUpdateNotification","")==token)return
  prefs.edit().putString("lastUpdateNotification",token).apply()
  val launch=PendingIntent.getActivity(this,2,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  try{(getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(20,Notification.Builder(this,"updates").setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("TinyFrens update ready").setContentText("Open TinyFrens to install the new Android build.").setContentIntent(launch).setAutoCancel(true).build())}catch(_:Exception){}
 }
 private fun removeMenu(){removeCloseButton();handler.removeCallbacks(closeMenu);menu?.let{try{wm.removeView(it)}catch(_:Exception){}};menu=null;menuAbove=false;removeCaption()}
 private fun removeToy(){toy?.let{try{wm.removeView(it)}catch(_:Exception){}};toy=null}
 private fun spawnToy(){
  removeToy();store.setMode("roam");lastRead=0;val(bx,by)=bounds();tx=Random.nextFloat()*bx;ty=Random.nextFloat()*by
  val ball=TextView(this).apply{text="●";textSize=28f;setTextColor(Color.rgb(130,235,161));gravity=Gravity.CENTER;setOnClickListener{spawnToy()}}
  val p=overlay(dp(36),dp(36));p.x=(tx+dp(22)).toInt();p.y=(ty+dp(22)).toInt()
  try{wm.addView(ball,p);toy=ball;behavior="walk";nextDecision=SystemClock.elapsedRealtime()+12000}catch(_:Exception){}
 }
 private fun savePosition(){position.edit().putInt("x",x.toInt()).putInt("y",y.toInt()).apply()}
 override fun onConfigurationChanged(c:Configuration){super.onConfigurationChanged(c);removeMenu();removeToy();clamp();pet?.let{v->params?.let{p->update(v,p)}};nextDecision=0}
 override fun onDestroy(){running=false;pet?.animate()?.cancel();removeEffects();handler.removeCallbacksAndMessages(null);try{unregisterReceiver(screenReceiver)}catch(_:Exception){};savePosition();removeMenu();removeChat();removeToy();clearGuests();pet?.let{try{wm.removeView(it)}catch(_:Exception){}};pet=null;params=null;super.onDestroy()}
 override fun onBind(i:Intent?):IBinder?=null
}


