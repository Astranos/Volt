/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as admin from "../admin.js";
import type * as aiScanner from "../aiScanner.js";
import type * as aiScannerQuota from "../aiScannerQuota.js";
import type * as catalog_activity from "../catalog/activity.js";
import type * as catalog_attributes from "../catalog/attributes.js";
import type * as catalog_crawl from "../catalog/crawl.js";
import type * as catalog_dedupe from "../catalog/dedupe.js";
import type * as catalog_extract from "../catalog/extract.js";
import type * as catalog_fixtures from "../catalog/fixtures.js";
import type * as catalog_hosts from "../catalog/hosts.js";
import type * as catalog_parseTitle from "../catalog/parseTitle.js";
import type * as catalog_paymoreApi from "../catalog/paymoreApi.js";
import type * as catalog_pricecharting from "../catalog/pricecharting.js";
import type * as catalog_store from "../catalog/store.js";
import type * as catalog_types from "../catalog/types.js";
import type * as catalog_validators from "../catalog/validators.js";
import type * as catalogActivity from "../catalogActivity.js";
import type * as cloudWorkspace from "../cloudWorkspace.js";
import type * as cloudWorkspace_batches from "../cloudWorkspace/batches.js";
import type * as cloudWorkspace_deliveries from "../cloudWorkspace/deliveries.js";
import type * as cloudWorkspace_devices from "../cloudWorkspace/devices.js";
import type * as cloudWorkspace_dictation from "../cloudWorkspace/dictation.js";
import type * as cloudWorkspace_identity from "../cloudWorkspace/identity.js";
import type * as cloudWorkspace_photos from "../cloudWorkspace/photos.js";
import type * as cloudWorkspace_snapshot from "../cloudWorkspace/snapshot.js";
import type * as crons from "../crons.js";
import type * as extensionSettings from "../extensionSettings.js";
import type * as http from "../http.js";
import type * as http_computers from "../http/computers.js";
import type * as http_products from "../http/products.js";
import type * as http_shared from "../http/shared.js";
import type * as http_shopify from "../http/shopify.js";
import type * as http_shopifyCompliance from "../http/shopifyCompliance.js";
import type * as http_signal from "../http/signal.js";
import type * as http_signalLogging from "../http/signalLogging.js";
import type * as kioskRequestValidators from "../kioskRequestValidators.js";
import type * as kioskRequests from "../kioskRequests.js";
import type * as paymoreCatalog from "../paymoreCatalog.js";
import type * as paymoreCrawl from "../paymoreCrawl.js";
import type * as pricechartingCrawl from "../pricechartingCrawl.js";
import type * as productApiKeyCrypto from "../productApiKeyCrypto.js";
import type * as productApiKeys from "../productApiKeys.js";
import type * as productData from "../productData.js";
import type * as scannerPush from "../scannerPush.js";
import type * as scannerSignal_cleanup from "../scannerSignal/cleanup.js";
import type * as scannerSignal_httpAdapter from "../scannerSignal/httpAdapter.js";
import type * as scannerSignal_joinAttempts from "../scannerSignal/joinAttempts.js";
import type * as scannerSignal_joinTokens from "../scannerSignal/joinTokens.js";
import type * as scannerSignal_logging from "../scannerSignal/logging.js";
import type * as scannerSignal_lookups from "../scannerSignal/lookups.js";
import type * as scannerSignal_pairings from "../scannerSignal/pairings.js";
import type * as scannerSignal_reconnectRequests from "../scannerSignal/reconnectRequests.js";
import type * as scannerSignal_rendezvous from "../scannerSignal/rendezvous.js";
import type * as scannerSignal_responses from "../scannerSignal/responses.js";
import type * as scannerSignal_routeCommands from "../scannerSignal/routeCommands.js";
import type * as scannerSignal_transitions from "../scannerSignal/transitions.js";
import type * as scannerSignal_validators from "../scannerSignal/validators.js";
import type * as shopifyAudit from "../shopifyAudit.js";
import type * as shopifyCompliance from "../shopifyCompliance.js";
import type * as shopifyHelpers from "../shopifyHelpers.js";
import type * as shopifyStore from "../shopifyStore.js";
import type * as storeKit from "../storeKit.js";
import type * as storeKitData from "../storeKitData.js";
import type * as workspaceMaintenance from "../workspaceMaintenance.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  admin: typeof admin;
  aiScanner: typeof aiScanner;
  aiScannerQuota: typeof aiScannerQuota;
  "catalog/activity": typeof catalog_activity;
  "catalog/attributes": typeof catalog_attributes;
  "catalog/crawl": typeof catalog_crawl;
  "catalog/dedupe": typeof catalog_dedupe;
  "catalog/extract": typeof catalog_extract;
  "catalog/fixtures": typeof catalog_fixtures;
  "catalog/hosts": typeof catalog_hosts;
  "catalog/parseTitle": typeof catalog_parseTitle;
  "catalog/paymoreApi": typeof catalog_paymoreApi;
  "catalog/pricecharting": typeof catalog_pricecharting;
  "catalog/store": typeof catalog_store;
  "catalog/types": typeof catalog_types;
  "catalog/validators": typeof catalog_validators;
  catalogActivity: typeof catalogActivity;
  cloudWorkspace: typeof cloudWorkspace;
  "cloudWorkspace/batches": typeof cloudWorkspace_batches;
  "cloudWorkspace/deliveries": typeof cloudWorkspace_deliveries;
  "cloudWorkspace/devices": typeof cloudWorkspace_devices;
  "cloudWorkspace/dictation": typeof cloudWorkspace_dictation;
  "cloudWorkspace/identity": typeof cloudWorkspace_identity;
  "cloudWorkspace/photos": typeof cloudWorkspace_photos;
  "cloudWorkspace/snapshot": typeof cloudWorkspace_snapshot;
  crons: typeof crons;
  extensionSettings: typeof extensionSettings;
  http: typeof http;
  "http/computers": typeof http_computers;
  "http/products": typeof http_products;
  "http/shared": typeof http_shared;
  "http/shopify": typeof http_shopify;
  "http/shopifyCompliance": typeof http_shopifyCompliance;
  "http/signal": typeof http_signal;
  "http/signalLogging": typeof http_signalLogging;
  kioskRequestValidators: typeof kioskRequestValidators;
  kioskRequests: typeof kioskRequests;
  paymoreCatalog: typeof paymoreCatalog;
  paymoreCrawl: typeof paymoreCrawl;
  pricechartingCrawl: typeof pricechartingCrawl;
  productApiKeyCrypto: typeof productApiKeyCrypto;
  productApiKeys: typeof productApiKeys;
  productData: typeof productData;
  scannerPush: typeof scannerPush;
  "scannerSignal/cleanup": typeof scannerSignal_cleanup;
  "scannerSignal/httpAdapter": typeof scannerSignal_httpAdapter;
  "scannerSignal/joinAttempts": typeof scannerSignal_joinAttempts;
  "scannerSignal/joinTokens": typeof scannerSignal_joinTokens;
  "scannerSignal/logging": typeof scannerSignal_logging;
  "scannerSignal/lookups": typeof scannerSignal_lookups;
  "scannerSignal/pairings": typeof scannerSignal_pairings;
  "scannerSignal/reconnectRequests": typeof scannerSignal_reconnectRequests;
  "scannerSignal/rendezvous": typeof scannerSignal_rendezvous;
  "scannerSignal/responses": typeof scannerSignal_responses;
  "scannerSignal/routeCommands": typeof scannerSignal_routeCommands;
  "scannerSignal/transitions": typeof scannerSignal_transitions;
  "scannerSignal/validators": typeof scannerSignal_validators;
  shopifyAudit: typeof shopifyAudit;
  shopifyCompliance: typeof shopifyCompliance;
  shopifyHelpers: typeof shopifyHelpers;
  shopifyStore: typeof shopifyStore;
  storeKit: typeof storeKit;
  storeKitData: typeof storeKitData;
  workspaceMaintenance: typeof workspaceMaintenance;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
