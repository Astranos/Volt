package com.volt.mobile

import android.app.Application
import com.clerk.api.Clerk

class VoltApplication : Application() {
    override fun onCreate() { super.onCreate(); Clerk.initialize(this, AppConfiguration.CLERK_PUBLISHABLE_KEY) }
}
