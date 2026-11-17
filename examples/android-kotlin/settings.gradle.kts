pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "pli-android-example"
include(":app")

// The Pli package for Android, from where it lives in the repository. In your own app, depend on the published package instead.
include(":pli")
project(":pli").projectDir = file("../../packages/kotlin-android")
