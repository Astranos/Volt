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
  assert.match(storeKitSource, /return \[\.appAccountToken\(appAccountToken\)\]/);
  assert.match(subscriptionViewSource, /\.inAppPurchaseOptions \{ _ in\s+await subscriptionStore\.purchaseOptions\(using: clerk\)/);
  assert.match(subscriptionViewSource, /\.onInAppPurchaseCompletion \{ _, result in\s+await subscriptionStore\.completePurchase\(result, using: clerk\)/);
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
  assert.match(storeKitSource, /subscription\.isEligibleForIntroOffer/);
  assert.match(storeKitSource, /offer\.paymentMode == \.freeTrial/);
});

test("purchase screen states subscription title, length, price, and policy links (Guideline 3.1.2(c))", () => {
  assert.match(
    subscriptionViewSource,
    /SubscriptionStoreView\(productIDs: \[AppConfiguration\.storeKitProductID\]\)/
  );
  // The subscribe and restore controls are ordinary SwiftUI buttons so they pick up the
  // Liquid Glass press animation, while `subscribe()` keeps the purchase inside
  // SubscriptionStoreView.
  assert.match(subscriptionViewSource, /struct GlassSubscriptionControlStyle: SubscriptionStoreControlStyle/);
  assert.match(subscriptionViewSource, /option\.subscribe\(\)/);
  assert.match(subscriptionViewSource, /\.buttonStyle\(\.glassProminent\)/);
  assert.match(subscriptionViewSource, /\.storeButton\(\.hidden, for: \.restorePurchases, \.policies\)/);
  assert.match(subscriptionViewSource, /subscriptionStore\.restore\(using: clerk\)/);

  // Both policy links belong in the pinned control area, not the scrolling content the
  // bottom bar covers, so the reviewer sees them without scrolling.
  const glassControlsSource = subscriptionViewSource.slice(
    subscriptionViewSource.indexOf("struct GlassSubscriptionControls: View"),
    subscriptionViewSource.indexOf("struct PaywallUnavailableView: View")
  );
  assert.ok(glassControlsSource.length > 0);
  assert.match(glassControlsSource, /Link\("Terms of Use", destination: AppConfiguration\.termsOfUseURL\)/);
  assert.match(glassControlsSource, /Link\("Privacy Policy", destination: AppConfiguration\.privacyPolicyURL\)/);

  assert.match(subscriptionViewSource, /subscriptionStore\.planSummary/);
  assert.match(subscriptionViewSource, /subscriptionStore\.renewalDisclosure/);
  assert.match(storeKitSource, /static func purchaseCaption\(for product: Product, activeOffer: Product\.SubscriptionOffer\?\)/);

  // A rejected or unavailable product must not strand the reviewer on the store view's
  // bare "Subscription Unavailable" placeholder with no policy links and no sign-out.
  assert.match(subscriptionViewSource, /if subscriptionStore\.isProductUnavailable \{\s*PaywallUnavailableView\(\)/);
  assert.match(storeKitSource, /product == nil && !isLoadingProduct && hasAttemptedProductLoad/);
  assert.match(subscriptionViewSource, /struct PaywallUnavailableView: View/);

  // Length and price must come from StoreKit, never from a hardcoded fallback price.
  assert.match(storeKitSource, /product\.displayPrice/);
  assert.match(storeKitSource, /renewalPeriodDescription\(subscription\.subscriptionPeriod\)/);
  assert.doesNotMatch(storeKitSource + subscriptionViewSource, /\$\d/);
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
  assert.match(subscriptionViewSource, /SubscriptionPaywallView\(\)/);
  assert.doesNotMatch(accountViewSource + accessSettingsSource, /Free Sessions/);
  assert.doesNotMatch(subscriptionViewSource + accessSettingsSource, /Transaction\.currentEntitlements/);
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
