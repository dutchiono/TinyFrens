package com.example.floatingpet
import android.app.Activity
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import org.json.JSONObject
class PetFileProvider:FileProvider()
object UpdateInstaller {
 fun download(activity:Activity,release:JSONObject,repo:String):File {
  val url=release.getString("url");require(UpdateChecker.allowedDownload(url,repo)){"Invalid update URL."}
  val expected=release.optString("sha256");require(expected.matches(Regex("[0-9a-fA-F]{64}"))){"Older release has no checksum. Use browser download."}
  val dir=File(activity.cacheDir,"updates").apply{mkdirs()};val partial=File(dir,"pet.part");val apk=File(dir,"pet.apk")
  val c=URL(url).openConnection() as HttpURLConnection;c.connectTimeout=15000;c.readTimeout=30000
  try{
   require(c.responseCode==200){"Download failed. Retry or use browser download."}
   val digest=MessageDigest.getInstance("SHA-256");var count=0L
   c.inputStream.use{input->partial.outputStream().use{output->
    val buffer=ByteArray(65536)
    while(true){val n=input.read(buffer);if(n<0)break;count+=n;require(count<=100L*1024*1024){"APK is too large."};digest.update(buffer,0,n);output.write(buffer,0,n)}
   }}
   val hash=digest.digest().joinToString(""){"%02x".format(it)}
   require(hash.equals(expected,true)){"Download checksum failed. Please retry."}
   @Suppress("DEPRECATION")
   val archive=activity.packageManager.getPackageArchiveInfo(partial.path,0)
   require(archive?.packageName==activity.packageName){"This APK is not TinyFrens."}
   apk.delete();require(partial.renameTo(apk)){"Cannot prepare update."};return apk
  }finally{c.disconnect();partial.delete()}
 }
 fun install(activity:Activity,file:File){
  val uri=FileProvider.getUriForFile(activity,activity.packageName+".updates",file)
  activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
 }
}
