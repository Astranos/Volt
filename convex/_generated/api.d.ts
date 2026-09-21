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
import type * as browserAgent from "../browserAgent.js";
import type * as browserAgent_contracts from "../browserAgent/contracts.js";
import type * as browserAgent_decision from "../browserAgent/decision.js";
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
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as kioskRequestValidators from "../kioskRequestValidators.js";
import type * as kioskRequests from "../kioskRequests.js";
import type * as paymoreCatalog from "../paymoreCatalog.js";
import type * as paymoreCrawl from "../paymoreCrawl.js";
import type * as priceAudit from "../priceAudit.js";
import type * as priceAudit_contracts from "../priceAudit/contracts.js";
import type * as priceAudit_decisions from "../priceAudit/decisions.js";
import type * as priceAudit_jevClient from "../priceAudit/jevClient.js";
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
import type * as storeKit from "../storeKit.js";
import type * as storeKitData from "../storeKitData.js";

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
  browserAgent: typeof browserAgent;
  "browserAgent/contracts": typeof browserAgent_contracts;
  "browserAgent/decision": typeof browserAgent_decision;
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
  crons: typeof crons;
  http: typeof http;
  kioskRequestValidators: typeof kioskRequestValidators;
  kioskRequests: typeof kioskRequests;
  paymoreCatalog: typeof paymoreCatalog;
  paymoreCrawl: typeof paymoreCrawl;
  priceAudit: typeof priceAudit;
  "priceAudit/contracts": typeof priceAudit_contracts;
  "priceAudit/decisions": typeof priceAudit_decisions;
  "priceAudit/jevClient": typeof priceAudit_jevClient;
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
  storeKit: typeof storeKit;
  storeKitData: typeof storeKitData;
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
