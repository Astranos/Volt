/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as scannerPush from "../scannerPush.js";
import type * as scannerSignal_cleanup from "../scannerSignal/cleanup.js";
import type * as scannerSignal_httpAdapter from "../scannerSignal/httpAdapter.js";
import type * as scannerSignal_joinAttempts from "../scannerSignal/joinAttempts.js";
import type * as scannerSignal_joinTokens from "../scannerSignal/joinTokens.js";
import type * as scannerSignal_lookups from "../scannerSignal/lookups.js";
import type * as scannerSignal_pairings from "../scannerSignal/pairings.js";
import type * as scannerSignal_reconnectRequests from "../scannerSignal/reconnectRequests.js";
import type * as scannerSignal_responses from "../scannerSignal/responses.js";
import type * as scannerSignal_routeCommands from "../scannerSignal/routeCommands.js";
import type * as scannerSignal_transitions from "../scannerSignal/transitions.js";
import type * as scannerSignal_validators from "../scannerSignal/validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  http: typeof http;
  scannerPush: typeof scannerPush;
  "scannerSignal/cleanup": typeof scannerSignal_cleanup;
  "scannerSignal/httpAdapter": typeof scannerSignal_httpAdapter;
  "scannerSignal/joinAttempts": typeof scannerSignal_joinAttempts;
  "scannerSignal/joinTokens": typeof scannerSignal_joinTokens;
  "scannerSignal/lookups": typeof scannerSignal_lookups;
  "scannerSignal/pairings": typeof scannerSignal_pairings;
  "scannerSignal/reconnectRequests": typeof scannerSignal_reconnectRequests;
  "scannerSignal/responses": typeof scannerSignal_responses;
  "scannerSignal/routeCommands": typeof scannerSignal_routeCommands;
  "scannerSignal/transitions": typeof scannerSignal_transitions;
  "scannerSignal/validators": typeof scannerSignal_validators;
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
