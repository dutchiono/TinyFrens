package com.example.floatingpet

import android.content.Context
import org.json.JSONObject
import org.mozilla.javascript.Context as RhinoContext
import org.mozilla.javascript.Function
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.ScriptableObject

class PetEngine(context: Context) {
 private val lock = Any()
 private val source = context.assets.open("pet-engine.js").bufferedReader().use { it.readText() }
 private val scope: Scriptable

 init {
  val cx = RhinoContext.enter()
  try {
   cx.optimizationLevel = -1
   scope = cx.initStandardObjects()
   cx.evaluateString(scope, source, "pet-engine.js", 1, null)
  } finally {
   RhinoContext.exit()
  }
 }

 fun bridge(method: String, state: JSONObject, argJson: String = ""): JSONObject = synchronized(lock) {
  val cx = RhinoContext.enter()
  try {
   cx.optimizationLevel = -1
   val engine = ScriptableObject.getProperty(scope, "TinyFrensEngine") as Scriptable
   val fn = ScriptableObject.getProperty(engine, "bridge") as Function
   val result = fn.call(cx, scope, engine, arrayOf(method, state.toString(), argJson, System.currentTimeMillis().toDouble()))
   JSONObject(RhinoContext.toString(result))
  } finally {
   RhinoContext.exit()
  }
 }
}
