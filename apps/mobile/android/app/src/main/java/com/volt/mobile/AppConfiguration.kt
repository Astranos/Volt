package com.volt.mobile

import java.net.URI

/**
 * Single source of truth for endpoints and keys, mirroring the iOS
 * `Volt/App/AppConfiguration.swift` defaults.
 */
object AppConfiguration {
    const val CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsudm9sdC5qdWFucXVlbmdhLmNvbSQ"
    const val PRIVACY_POLICY_URL = "https://volt-scanner.vercel.app/privacy"
    const val TERMS_OF_USE_URL =
        "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"

    const val DEFAULT_PRODUCT_ID = "com.volt.mobile.pro.monthly"

    const val CLERK_JWT_TEMPLATE = "convex"

    val convexSiteUrl: URI = URI.create(
        if (BuildConfig.DEBUG) {
            "https://adorable-hornet-19.convex.site"
        } else {
            "https://sincere-trout-414.convex.site"
        },
    )

    val convexCloudUrl: URI = URI.create(
        if (BuildConfig.DEBUG) {
            "https://adorable-hornet-19.convex.cloud"
        } else {
            "https://sincere-trout-414.convex.cloud"
        },
    )
}
