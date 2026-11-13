export function billingConfiguration() {
  let appUrl: string | null = null;
  try {
    const url = new URL(process.env.APP_URL ?? "");
    if (
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      appUrl = url.origin;
  } catch {
    /* Missing or invalid configuration keeps checkout disabled. */
  }
  const workspacePrice = process.env.STRIPE_WORKSPACE_PRICE_ID;
  const billingEnabled =
    process.env.BILLING_ENABLED === "true" &&
    Boolean(
      process.env.STRIPE_SECRET_KEY &&
        process.env.STRIPE_WEBHOOK_SECRET &&
        appUrl,
    );
  return {
    appUrl,
    billingEnabled,
    workspacePrice,
    workspaceEnabled:
      billingEnabled && Boolean(workspacePrice?.startsWith("price_")),
  };
}
