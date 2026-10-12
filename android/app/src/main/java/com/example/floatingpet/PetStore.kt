package com.example.floatingpet
import android.content.Context
import org.json.JSONObject

class PetStore(context:Context) {
 companion object {private val lock=Any()}
 private val prefs=context.getSharedPreferences("pet",Context.MODE_PRIVATE)
 private val engine=PetEngine(context.applicationContext)

 private fun legacyState():JSONObject{
  val now=System.currentTimeMillis()
  return JSONObject()
   .put("hunger",prefs.getInt("hunger",80))
   .put("happiness",prefs.getInt("happiness",80))
   .put("energy",prefs.getInt("energy",80))
   .put("born",prefs.getLong("born",now))
   .put("last",prefs.getLong("last",now))
   .put("mode",prefs.getString("mode","roam"))
   .put("color",prefs.getString("color","#a474f1"))
   .put("shape",prefs.getString("shape","cat"))
   .put("opacity",prefs.getInt("opacity",100))
   .put("sparkles",prefs.getBoolean("sparkles",true))
   .put("screenEffects",prefs.getBoolean("screenEffects",true))
   .put("fade",prefs.getBoolean("fade",true))
   .put("haptics",prefs.getBoolean("haptics",true))
   .put("reduceMotion",prefs.getBoolean("reduceMotion",false))
   .put("sounds",prefs.getBoolean("sounds",true))
   .put("size",prefs.getInt("size",80))
   .put("speed",prefs.getInt("speed",60))
   .put("name",prefs.getString("name",""))
   .put("action",prefs.getString("action","idle"))
   .put("actionUntil",prefs.getLong("actionUntil",0))
 }
 private fun state():JSONObject{
  val raw=prefs.getString("state",null)
  if(!raw.isNullOrBlank())try{return JSONObject(raw)}catch(_:Exception){}
  return legacyState()
 }
 private fun save(state:JSONObject){prefs.edit().putString("state",state.toString()).apply()}
 private fun run(method:String,argJson:String=""):JSONObject{
  val out=engine.bridge(method,state(),argJson)
  save(out.getJSONObject("state"))
  val view=out.getJSONObject("view")
  if(out.has("blocked"))view.put("blocked",out.optBoolean("blocked"))
  if(out.has("feedback"))view.put("feedback",out.optString("feedback"))
  if(out.has("animation"))view.put("animation",out.optString("animation"))
  return view
 }
 fun read():JSONObject=synchronized(lock){run("read")}
 fun act(action:String):JSONObject=synchronized(lock){run("act",JSONObject.quote(action))}
 fun setMode(mode:String):JSONObject=synchronized(lock){run("mode",JSONObject.quote(mode))}
 fun rename(name:String):JSONObject=synchronized(lock){run("rename",JSONObject.quote(name))}
 fun customize(json:String):JSONObject=synchronized(lock){
  val patch=try{JSONObject(json)}catch(_:Exception){JSONObject()}
  run("customize",patch.toString())
 }
}
