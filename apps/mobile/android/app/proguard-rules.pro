# Clerk Android SDK
-keep class com.clerk.** { *; }
-dontwarn com.clerk.**

# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.volt.mobile.**$$serializer { *; }
-keepclassmembers class com.volt.mobile.** { *** Companion; }
-keepclasseswithmembers class com.volt.mobile.** { kotlinx.serialization.KSerializer serializer(...); }

# WebRTC
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
