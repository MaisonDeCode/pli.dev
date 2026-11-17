plugins {
    kotlin("jvm") version "2.4.10"
    kotlin("plugin.serialization") version "2.4.10"
}

group = "dev.pli"
version = "0.0.0"

repositories {
    mavenCentral()
}

dependencies {
    // QuickJS runs the engine. On Android, use `io.github.dokar3:quickjs-kt` (the Android build of the same library) instead of the JVM one.
    api("io.github.dokar3:quickjs-kt-jvm:1.0.15")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(21)
}

tasks.test {
    useJUnitPlatform()
}
