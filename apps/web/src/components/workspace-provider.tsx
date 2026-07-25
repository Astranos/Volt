import { useState, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { CONVEX_URL } from "../lib/env";

/**
 * Convex lives only under the signed-in surface. Keeping the client out of the
 * marketing tree means the landing page never opens a websocket, and the
 * static build never constructs one while prerendering.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false }),
  );

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
