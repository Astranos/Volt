export type PeerReadyWorkOptions = {
  peerReady: boolean;
  deliver: () => Promise<unknown> | unknown;
  reject: () => Promise<unknown> | unknown;
};

export async function routePeerReadyWork({
  peerReady,
  deliver,
  reject,
}: PeerReadyWorkOptions) {
  if (!peerReady) {
    await reject();
    return "rejected" as const;
  }
  await deliver();
  return "delivered" as const;
}
