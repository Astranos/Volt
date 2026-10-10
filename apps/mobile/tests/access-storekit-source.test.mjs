import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readClipViewSources } from "./clip-view-sources.mjs";

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
const screenshotFixtureSource = readIOSSource("Volt/Services/ScreenshotFixtures.swift");
const screenshotHarnessSource = readIOSSource("VoltScreenshots/VoltScreenshots.swift");
const clipRootSource = readClipViewSources();
const clipStoreSource = readIOSSource("VoltClip/Services/ClipScannerStore.swift");
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
  assert.match(configurationSource, /static let clerkPublishableKey\s*=\s*(configuredString\(for: "VoltClerkPublishableKey"\) \?\? )?"pk_live_[A-Za-z0-9]+"/);
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
  assert.match(accessStatusSource, /enum AccessPlan: String, Decodable, Sendable/);
  assert.match(accessStatusSource, /struct AccessCapabilities: Decodable, Sendable/);
  assert.match(accessStatusSource, /enum AIScannerQuota: Decodable, Equatable, Sendable/);
  assert.match(accessStatusSource, /timeIntervalSince1970: try container\.decode\(Double\.self, forKey: \.resetsAt\) \/ 1_000/);
  assert.match(accessStatusSource, /let aiScannerQuota: AIScannerQuota\?/);
  assert.match(accessStatusSource, /let legacyProAccess = access == \.complimentary \|\| access == \.subscription/);
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
  assert.match(storeKitSource, /return \[\.appAccountToken\(appAccountToken\)\]/);
  assert.match(storeKitSource, /func purchaseOptions\(using clerk: Clerk\)/);
  assert.match(storeKitSource, /func completePurchase\(/);
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

test("full app launches signed-in users immediately and refreshes access in the background", () => {
  assert.match(rootSceneSource, /else \{\s*RootView\(\)/);
  assert.doesNotMatch(rootSceneSource, /FullAppAccessLoadingView|SubscriptionPaywallView/);
  assert.match(rootSceneSource, /\.task\(id: authenticationContext\) \{\s*await refreshAuthenticatedAccess\(\)/);
  assert.match(rootSceneSource, /\.task\(id: credentialContext\) \{\s*await configureDeviceCredential\(\)/);
  assert.match(rootSceneSource, /\.task\(id: cloudWorkspaceCapabilityContext\) \{\s*configureCloudWorkspaceCapability\(\)/);
  assert.match(rootSceneSource, /await accessStore\.refresh\(using: clerk\)/);
  assert.match(rootSceneSource, /await scannerStore\.cloudWorkspace\.bootstrapIfNeeded\(using: clerk\)/);
  assert.match(rootSceneSource, /setCloudWorkspaceEnabled\([\s\n]*clerk\.user != nil && accessStore\.status\?\.capabilities\.cloudWorkspace == true/);
  assert.doesNotMatch(subscriptionViewSource, /SubscriptionPaywallView|Volt Pro|See Volt Pro Plan|Start.*Trial/i);
});

test("account keeps restore and manage controls for existing App Store purchases only", () => {
  assert.match(subscriptionViewSource, /Section\("Existing App Store purchases"\)/);
  assert.match(subscriptionViewSource, /Restore Purchases/);
  assert.match(subscriptionViewSource, /Manage in App Store/);
  assert.match(subscriptionViewSource, /subscriptionStore\.restore\(using: clerk\)/);
  assert.doesNotMatch(subscriptionViewSource, /SubscriptionPaywallView|Volt Pro|See Volt Pro Plan|Start.*Trial/i);
  assert.doesNotMatch(subscriptionViewSource, /\$\d/);
});

test("canceled StoreKit purchases do not become visible errors", () => {
  assert.match(storeKitSource, /catch let error as StoreKitError[\s\S]*if case \.userCancelled = error[\s\S]*return/);
});

test("account UI shows free scanner access, cloud workspace, AI quota, and purchase status", () => {
  assert.match(accountViewSource, /UserButton\(\)/);
  assert.match(accountViewSource, /OrganizationSwitcher\(\)/);
  assert.match(accountViewSource, /Section\("Account"\)/);
  assert.match(accountViewSource, /Section\("Workspace"\)/);
  assert.match(accountViewSource, /Section\("Volt access"\)/);
  assert.match(accountViewSource, /LabeledContent\("Scanner"/);
  assert.match(accountViewSource, /LabeledContent\("Local Capture", value: "Included"\)/);
  assert.match(accountViewSource, /"Cloud Workspace"/);
  assert.match(accountViewSource, /LabeledContent\("AI Scans"/);
  assert.match(accountViewSource, /remaining this month/);
  assert.match(accountViewSource, /planLabel\(for _: AccessStatus\)[\s\S]*"Free"/);
  assert.match(accountViewSource, /status\.capabilities\.cloudWorkspace \? "Included" : "Unavailable"/);
  assert.match(accountViewSource, /LabeledContent\("Subscription"/);
  assert.doesNotMatch(accountViewSource + accessSettingsSource, /Full App Access|Subscription required/);
  assert.match(subscriptionViewSource, /accessStore\.isRefreshing \|\| !hasCurrentAccessContext/);
  assert.match(subscriptionViewSource, /status\.organizationId == clerk\.organization\?\.id/);
  assert.doesNotMatch(accountViewSource + accessSettingsSource, /Free Sessions/);
  assert.doesNotMatch(subscriptionViewSource + accessSettingsSource, /Transaction\.currentEntitlements/);
});

test("review screenshot shows the free workspace pilot", () => {
  assert.match(appSource, /VOLT_FREE_WORKSPACE_SCREENSHOT/);
  assert.match(appSource, /FreeWorkspaceScreenshotView\(\)/);
  assert.match(screenshotFixtureSource, /LabeledContent\("Scanner", value: "Free"\)/);
  assert.match(screenshotFixtureSource, /Cloud workspace/);
  assert.match(screenshotFixtureSource, /at no cost during the pilot/);
  assert.match(screenshotHarnessSource, /VOLT_FREE_WORKSPACE_SCREENSHOT/);
  assert.match(screenshotHarnessSource, /captureFreeWorkspace\(\)/);
  assert.match(screenshotHarnessSource, /10-volt-free-workspace/);
  assert.doesNotMatch(screenshotHarnessSource, /captureSubscriptionReview/);
  assert.doesNotMatch(screenshotHarnessSource, /Subscribe for \$|10-volt-pro-subscription/);
});

test("App Clip has no full-app entitlement blocker, authentication, or checkout", () => {
  assert.doesNotMatch(projectSource, /ClipUpgradeView/);
  assert.doesNotMatch(clipRootSource + clipStoreSource, /requiresFullApp|Full app required/);
  assert.doesNotMatch(clipRootSource, /SKOverlay|appStoreOverlay/);
  assert.doesNotMatch(clipInfoSource, /VoltAppStoreID/);
  assert.doesNotMatch(clipRootSource, /ClerkKit|AuthView|UserButton|\.purchase\(|AppStore\.sync/);
});

test("App Clip treats an invalid cloud workspace grant as retryable", () => {
  assert.match(clipStoreSource, /AppClipGuestCloudSession\(pairingSession: nextSession\)/);
  assert.match(clipStoreSource, /pairingFailureMessage = "This QR does not contain a valid workspace grant\."/);
  assert.match(clipStoreSource, /targetHint = "Scan a fresh Volt QR code"/);
  assert.match(clipStoreSource, /statusText = "Connection failed"/);
  assert.doesNotMatch(clipStoreSource, /requiresFullApp = true|Full app required/);
});
