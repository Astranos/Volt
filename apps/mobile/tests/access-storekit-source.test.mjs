import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readIOSSource = (relativePath) =>
  readFileSync(new URL(`../ios/${relativePath}`, import.meta.url), "utf8");

const projectSource = readIOSSource("Volt.xcodeproj/project.pbxproj");
const appSource = readIOSSource("Volt/App/VoltApp.swift");
const configurationSource = readIOSSource("Volt/App/AppConfiguration.swift");
const accessStatusSource = readIOSSource("Volt/Models/AccessStatus.swift");
const accessStoreSource = readIOSSource("Volt/Services/AccessStore.swift");
const apiClientSource = readIOSSource("Volt/Services/MobileAccessAPIClient.swift");
const storeKitSource = readIOSSource("Volt/Services/StoreKitSubscriptionStore.swift");
const accessSettingsSource = readIOSSource("Volt/Views/AccessSettingsSection.swift");
const accountViewSource = readIOSSource("Volt/Views/AccountAccessView.swift");
const subscriptionViewSource = readIOSSource("Volt/Views/SubscriptionActionsView.swift");
const rootSceneSource = readIOSSource("Volt/Views/VoltRootScene.swift");
const clipRootSource = readIOSSource("VoltClip/Views/ClipRootView.swift");
const clipUpgradeSource = readIOSSource("VoltClip/Views/ClipUpgradeView.swift");
const clipStoreSource = readIOSSource("VoltClip/Services/ClipScannerStore.swift");
const clipTransportSource = readIOSSource("VoltClip/Services/WebKitWebRTCTransport.swift");
const clipInfoSource = readIOSSource("VoltClip/Info.plist");
const entitlementSource = readIOSSource("Volt/Volt.entitlements");

test("full iOS target integrates ClerkKit and ClerkKitUI through Swift Package Manager", () => {
  assert.match(projectSource, /repositoryURL = "https:\/\/github\.com\/clerk\/clerk-ios"/);
  assert.match(projectSource, /minimumVersion = 1\.3\.0/);
  assert.match(projectSource, /productName = ClerkKit;/);
  assert.match(projectSource, /productName = ClerkKitUI;/);

  const fullTargetStart = projectSource.indexOf("F00000000000000000000001 /* Volt */");
  const clipTargetStart = projectSource.indexOf("F30000000000000000000001 /* VoltClip */");
  const fullTargetSource = projectSource.slice(fullTargetStart, clipTargetStart);
  assert.match(fullTargetSource, /packageProductDependencies = \([\s\S]*ClerkKit[\s\S]*ClerkKitUI/);

  const clipTargetEnd = projectSource.indexOf("/* End PBXNativeTarget section */", clipTargetStart);
  const clipTargetSource = projectSource.slice(clipTargetStart, clipTargetEnd);
  assert.doesNotMatch(clipTargetSource, /packageProductDependencies|ClerkKit/);
});

test("full app configures and injects Clerk through AppConfiguration", () => {
  assert.match(appSource, /Clerk\.configure\(publishableKey: AppConfiguration\.clerkPublishableKey\)/);
  assert.match(appSource, /clerk = Clerk\.shared/);
  assert.match(appSource, /\.environment\(clerk\)/);
  assert.match(appSource, /try await clerk\.handle\(url\)/);
  assert.match(configurationSource, /static let clerkPublishableKey = "pk_live_[A-Za-z0-9]+"/);
  assert.match(entitlementSource, /webcredentials:\$\(VOLT_CLERK_FRONTEND_API_DOMAIN\)/);
  assert.doesNotMatch(appSource + configurationSource, /sk_(test|live)_[A-Za-z0-9]+/);
});

test("authenticated access calls use fresh Clerk Convex tokens and authoritative status", () => {
  assert.match(
    accessStoreSource,
    /clerk\.auth\.getToken\([\s\S]*template: AppConfiguration\.clerkJWTTemplate,[\s\S]*skipCache: true[\s\S]*\)/
  );
  assert.match(configurationSource, /configuredString\(for: "VoltClerkJWTTemplate"\) \?\? "convex"/);
  assert.match(apiClientSource, /appending\(path: "api\/access\/status"\)/);
  assert.ok(
    apiClientSource.includes(
      'setValue("Bearer \\(bearerToken)", forHTTPHeaderField: "Authorization")'
    )
  );
  assert.match(accessStatusSource, /let access: AccessKind/);
  assert.match(accessStatusSource, /let hasFullAppAccess: Bool/);
  assert.match(accessStatusSource, /let freeSessionsRemaining: Int/);
  assert.match(accessStatusSource, /let subscriptionStatus: VoltSubscriptionStatus/);
  assert.match(accessStatusSource, /let organizationId: String\?/);
  assert.match(accessStatusSource, /let appAccountToken: UUID\?/);
  assert.doesNotMatch(accessStoreSource + apiClientSource, /UserDefaults|Keychain|SecItem/);
});

test("StoreKit purchase associates the server UUID and synchronizes verified JWS", () => {
  assert.match(configurationSource, /defaultStoreKitProductID = "com\.volt\.mobile\.pro\.monthly"/);
  assert.match(storeKitSource, /Product\.products\(for: \[productID\]\)/);
  assert.match(storeKitSource, /accessStore\.appAccountToken\(using: clerk\)/);
  assert.match(storeKitSource, /product\.purchase\(options: \[\.appAccountToken\(appAccountToken\)\]\)/);
  assert.match(storeKitSource, /case \.verified\(let transaction\)/);
  assert.match(storeKitSource, /transaction\.appAccountToken == appAccountToken/);
  assert.match(storeKitSource, /signedTransaction: verification\.jwsRepresentation/);
  assert.match(apiClientSource, /appending\(path: "api\/storekit\/transactions"\)/);
  assert.match(apiClientSource, /\["signedTransaction": signedTransaction\]/);
  assert.match(storeKitSource, /await transaction\.finish\(\)/);
});

test("StoreKit observes, restores, and replays current verified transactions", () => {
  assert.match(storeKitSource, /for await verification in Transaction\.updates/);
  assert.match(storeKitSource, /try await AppStore\.sync\(\)/);
  assert.match(storeKitSource, /for await verification in Transaction\.currentEntitlements/);
  assert.match(storeKitSource, /synchronize\(verification, using: clerk, finishesTransaction: true\)/);
  assert.match(storeKitSource, /await accessStore\.refresh\(using: clerk\)/);
});

test("full app gates capture behind subscription or complimentary access", () => {
  assert.match(rootSceneSource, /accessStore\.status\?\.hasFullAppAccess == true/);
  assert.match(rootSceneSource, /SubscriptionPaywallView\(\)/);
  assert.match(rootSceneSource, /activateCloudWorkspaceIfAuthorized/);
  assert.match(subscriptionViewSource, /struct SubscriptionPaywallView: View/);
  assert.match(subscriptionViewSource, /subscriptionStore\.purchaseButtonTitle/);
  assert.match(storeKitSource, /subscription\.isEligibleForIntroOffer/);
  assert.match(storeKitSource, /offer\.paymentMode == \.freeTrial/);
  assert.ok(storeKitSource.includes('return "Start \\(introductoryTrialPeriod) Free Trial"'));
});

test("account UI shows account, workspace, full-app access, and server subscription status", () => {
  assert.match(accountViewSource, /UserButton\(\)/);
  assert.match(accountViewSource, /OrganizationSwitcher\(\)/);
  assert.match(accountViewSource, /Section\("Account"\)/);
  assert.match(accountViewSource, /Section\("Workspace"\)/);
  assert.match(accountViewSource, /LabeledContent\("Full App Access"/);
  assert.match(accountViewSource, /LabeledContent\("Subscription"/);
  assert.match(subscriptionViewSource, /accessStore\.status\?\.access == \.complimentary/);
  assert.match(subscriptionViewSource, /Complimentary Volt Pro access/);
  assert.match(subscriptionViewSource, /accessStore\.isRefreshing \|\| !hasCurrentAccessContext/);
  assert.match(subscriptionViewSource, /status\.organizationId == clerk\.organization\?\.id/);
  assert.match(subscriptionViewSource, /purchaseButtonTitle/);
  assert.doesNotMatch(accountViewSource + accessSettingsSource, /Free Sessions/);
  assert.doesNotMatch(subscriptionViewSource + accessSettingsSource, /Transaction\.currentEntitlements/);
});

test("App Clip has upgrade handoff but no authentication or checkout", () => {
  assert.match(clipRootSource, /SKOverlay\.AppClipConfiguration\(position: \.bottom\)/);
  assert.match(clipRootSource, /store\.requiresFullApp/);
  assert.match(clipUpgradeSource, /The App Clip stays free and does not offer checkout/);
  assert.match(clipUpgradeSource, /6771770148/);
  assert.match(clipInfoSource, /<key>VoltAppStoreID<\/key>\s*<string>\$\(VOLT_APP_STORE_ID\)<\/string>/);
  assert.doesNotMatch(clipRootSource + clipUpgradeSource, /ClerkKit|AuthView|UserButton|\.purchase\(|AppStore\.sync/);
});

test("App Clip recognizes machine-readable access exhaustion", () => {
  assert.match(clipTransportSource, /var onProtocolError: \(\(ScannerProtocol\.ProtocolError\) -> Void\)\?/);
  assert.match(clipTransportSource, /onProtocolError\?\(protocolError\)/);
  assert.match(clipStoreSource, /transport\.onProtocolError = \{ \[weak self\] protocolError in/);
  assert.match(clipStoreSource, /guard error\.code == "access_exhausted" else \{ return \}/);
  assert.match(clipStoreSource, /requiresFullApp = true/);
  assert.match(clipStoreSource, /statusText = "Full app required"/);
});
