package com.example.floatingpet
import android.content.Context
import org.json.JSONObject
class PetStore(context:Context) {
 companion object {private val lock=Any()}
 private val prefs=context.getSharedPreferences("pet",Context.MODE_PRIVATE)
 fun read():JSONObject=synchronized(lock){
  if(prefs.getString("shape","cat")=="mascot")prefs.edit().putString("shape","robot").apply()
  val now=System.currentTimeMillis();val last=prefs.getLong("last",now).coerceAtMost(now)
  val hours=((now-last)/3600000L).coerceIn(0,720);val born=prefs.getLong("born",now)
  val hunger=(prefs.getInt("hunger",80)-hours.toInt()*3).coerceAtLeast(0)
  val happiness=(prefs.getInt("happiness",80)-hours.toInt()*2).coerceAtLeast(0)
  val energy=(prefs.getInt("energy",80)-hours.toInt()).coerceAtLeast(0)
  if(hours>0||!prefs.contains("last")||!prefs.contains("born"))
   prefs.edit().putInt("hunger",hunger).putInt("happiness",happiness).putInt("energy",energy)
    .putLong("born",born).putLong("last",if(hours>0)last+hours*3600000L else now).apply()
  JSONObject().put("hunger",hunger).put("happiness",happiness).put("energy",energy).put("born",born)
   .put("mode",prefs.getString("mode","roam")).put("stage",((now-born)/86400000L).coerceIn(0,2).toInt())
   .put("color",prefs.getString("color","#a474f1")).put("shape",prefs.getString("shape","cat"))
   .put("opacity",prefs.getInt("opacity",100)).put("sparkles",prefs.getBoolean("sparkles",true)).put("screenEffects",prefs.getBoolean("screenEffects",true)).put("fade",prefs.getBoolean("fade",true)).put("haptics",prefs.getBoolean("haptics",true)).put("reduceMotion",prefs.getBoolean("reduceMotion",false))
   .put("size",prefs.getInt("size",80)).put("speed",prefs.getInt("speed",60)).put("name",prefs.getString("name",""))
   .put("action",prefs.getString("action","idle")).put("actionUntil",prefs.getLong("actionUntil",0))
 }
 fun act(action:String):JSONObject=synchronized(lock){
  val s=read()
  val blocked=when{action=="feed"&&s.getInt("hunger")>=100->"Already full.";action=="rest"&&s.getInt("energy")>=100->"Not sleepy yet.";action=="play"&&s.getInt("energy")<12->"A nap first, then play.";action=="play"&&s.getInt("hunger")<8->"A snack first, then play.";else->""}
  if(blocked.isNotEmpty())return@synchronized s.put("blocked",true).put("feedback",blocked)
  val e=prefs.edit()
  fun adjust(k:String,n:Int){e.putInt(k,(s.getInt(k)+n).coerceIn(0,100))}
  when(action){"feed"->adjust("hunger",25);"play"->{adjust("happiness",20);adjust("energy",-12);adjust("hunger",-8)};"rest"->adjust("energy",25);"pet"->adjust("happiness",5)}
  val animation=when(action){"feed"->"eat";"play"->"dance";"rest"->"sleep";"wave"->"wave";"dance"->"dance";"pet"->"happy";else->"idle"}
  e.putString("action",animation).putLong("actionUntil",System.currentTimeMillis()+if(action=="rest")15000 else 6000).apply()
  val after=read()
  val feedback=when(action){"feed"->"Snacks +"+(after.getInt("hunger")-s.getInt("hunger"));"rest"->"Energy +"+(after.getInt("energy")-s.getInt("energy"));"play"->"Joy +"+(after.getInt("happiness")-s.getInt("happiness"))+" · Energy −12 · Snacks −8";else->""}
  after.put("feedback",feedback)
 }
 fun setMode(mode:String):JSONObject=synchronized(lock){if(mode in listOf("roam","bubble"))prefs.edit().putString("mode",mode).apply();read()}
 fun rename(name:String):JSONObject=synchronized(lock){
  val clean=name.replace(Regex("\\p{Cntrl}"),"").replace(Regex("\\s+")," ").trim()
  val end=if(clean.codePointCount(0,clean.length)>20)clean.offsetByCodePoints(0,20) else clean.length
  if(end>0)prefs.edit().putString("name",clean.substring(0,end)).apply();read()
 }
 fun customize(json:String):JSONObject=synchronized(lock){
  val o=try{JSONObject(json)}catch(_:Exception){return@synchronized read()};val e=prefs.edit()
  val color=o.optString("color");if(color.matches(Regex("#[0-9a-fA-F]{6}")))e.putString("color",color)
  val shape=o.optString("shape");if(shape in listOf("cat","blob","robot","bunny","dog","bear","frog","turtle"))e.putString("shape",shape)
  if(o.has("size"))e.putInt("size",o.optInt("size",80).coerceIn(56,128))
  if(o.has("speed"))e.putInt("speed",o.optInt("speed",60).coerceIn(20,140))
  if(o.has("opacity"))e.putInt("opacity",o.optInt("opacity",100).coerceIn(40,100))
  for(k in listOf("sparkles","screenEffects","fade","haptics","reduceMotion"))if(o.has(k))e.putBoolean(k,o.optBoolean(k,k!="reduceMotion"))
  e.apply();read()
 }
}


