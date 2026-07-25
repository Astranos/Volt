import { useEffect } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import {
  COMPUTER_REGISTRATION_INTERVAL_MS,
  registerComputer,
} from "../cloud-scanner/computer-registration";

/**
 * Keeps this computer listed as online on the phone.
 *
 * The presence row used to have exactly one writer, the offscreen document, and
 * that document reaches Clerk by a route no other surface depends on: the
 * service worker mirrors the account cookie into storage and Clerk picks it up
 * from there. When that mirror does not produce a session the document settles
 * on signed-out and simply stops — no subscription, no registration, and no
 * error, because being signed out is not a failure. The panel meanwhile signs
 * in on its own and looks perfectly healthy, so the phone shows no computer and
 * nothing anywhere says why.
 *
 * The panel already holds an authenticated Convex client, so it registers too.
 * Registration is keyed by install id, so whichever context is healthy keeps
 * the same row alive rather than creating a second computer.
 */
export function useComputerRegistration() {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    const beat = () => {
      void registerComputer(convex).catch((error: unknown) => {
        console.warn("[Volt Cloud Workspace] computer registration failed", error);
      });
    };
    beat();
    const timer = setInterval(beat, COMPUTER_REGISTRATION_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [convex, isAuthenticated]);
}
