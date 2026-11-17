plugins {
    id("com.android.library")
    kotlin("android")
    kotlin("plugin.serialization")
    kotlin("plugin.compose")
}

android {
    namespace = "dev.pli"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The engine's own code (`PliDocument` and the rest) is the Pli package for Kotlin in ../kotlin, compiled in here with the
    // Android build of QuickJS. The editor (`PliEditor`) and the page it shows are this module's.
    sourceSets["main"].java.srcDir("../kotlin/src/main/kotlin")
    sourceSets["main"].resources.srcDir("../kotlin/src/main/resources")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // The engine runs in QuickJS. This is the Android build of the same library the JVM package uses.
    api("io.github.dokar3:quickjs-kt:1.0.15")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")

    // `PliEditor` and the building blocks (`PliBlocks`, `PliToolbar`) are Jetpack Compose functions.
    implementation(platform("androidx.compose:compose-bom:2025.10.00"))
    api("androidx.compose.ui:ui")
    api("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.11.0")
}
