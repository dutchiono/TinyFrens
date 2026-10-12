plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.example.floatingpet"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.example.floatingpet"
        minSdk = 26
        targetSdk = 35
        versionCode = providers.gradleProperty("petVersionCode").orElse("3").get().toInt()
        versionName = providers.gradleProperty("petVersionName").orElse("0.3.0").get()
        buildConfigField("String", "UPDATE_REPO", "\"${providers.gradleProperty("updateRepo").orElse("").get()}\"")
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        create("release") {
            val keyPath = System.getenv("PET_KEYSTORE_PATH")
            if (!keyPath.isNullOrBlank()) {
                storeFile = file(keyPath)
                storePassword = System.getenv("PET_STORE_PASSWORD")?.trim()
                keyAlias = System.getenv("PET_KEY_ALIAS")?.trim()
                keyPassword = System.getenv("PET_KEY_PASSWORD")?.trim()
            }
        }
    }
    buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release") } }
    sourceSets.getByName("main").assets.srcDir("../../web")
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
 implementation("androidx.core:core:1.15.0")
 implementation("org.mozilla:rhino:1.7.15")
 implementation("com.caverock:androidsvg-aar:1.4")
 testImplementation("junit:junit:4.13.2")
}
