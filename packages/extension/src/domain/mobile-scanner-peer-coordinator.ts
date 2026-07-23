import type { PeerSession } from "./mobile-scanner-peer-connection";
import { routePeerReadyWork } from "./mobile-scanner-peer-readiness.ts";

type PeerCoordinatorOptions = {
  closePeer: (peer: PeerSession, explicitlyEnded: boolean) => void;
  deliverControl: (peer: PeerSession, rawData: string) => Promise<void>;
  deliverPhoto: (peer: PeerSession, data: unknown) => Promise<unknown>;
  isActive: (peer: PeerSession) => boolean;
  log?: (...args: unknown[]) => void;
  sendInvalidState: (peer: PeerSession, receivedType: string) => void;
};

export class MobileScannerPeerCoordinator {
  private readonly closingPeers = new Set<string>();
  private readonly controlQueues = new Map<string, Promise<void>>();
  private readonly options: PeerCoordinatorOptions;

  constructor(options: PeerCoordinatorOptions) {
    this.options = options;
  }

  enqueueControl(peer: PeerSession, rawData: string) {
    const previous = this.controlQueues.get(peer.id) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        if (this.options.isActive(peer)) {
          await this.options.deliverControl(peer, rawData);
        }
      })
      .catch((error) => this.options.log?.("Failed to handle scanner control message", error));
    this.controlQueues.set(peer.id, next);
    void next.finally(() => {
      if (this.controlQueues.get(peer.id) === next) this.controlQueues.delete(peer.id);
    });
    return next;
  }

  enqueuePhoto(peer: PeerSession, data: unknown) {
    const controlQueue = this.controlQueues.get(peer.id) ?? Promise.resolve();
    return controlQueue
      .then(async () => {
        if (!this.options.isActive(peer)) return;
        await this.deliverReadyWork(peer, "photo_transfer", () =>
          this.options.deliverPhoto(peer, data),
        );
      })
      .catch((error) => this.options.log?.("Failed to handle scanner photo message", error));
  }

  deliverReadyWork(
    peer: PeerSession,
    receivedType: string,
    deliver: () => Promise<unknown> | unknown,
  ) {
    return routePeerReadyWork({
      peerReady: peer.ready,
      deliver,
      reject: () => this.rejectPreReady(peer, receivedType),
    });
  }

  async closeAfterControlFlush(peer: PeerSession, explicitlyEnded: boolean) {
    if (this.closingPeers.has(peer.id)) return;
    this.closingPeers.add(peer.id);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await this.waitForControlDrain(peer.control);
      this.options.closePeer(peer, explicitlyEnded);
    } finally {
      this.closingPeers.delete(peer.id);
    }
  }

  private async rejectPreReady(peer: PeerSession, receivedType: string) {
    if (this.closingPeers.has(peer.id)) return;
    this.options.sendInvalidState(peer, receivedType);
    await this.closeAfterControlFlush(peer, true);
  }

  private async waitForControlDrain(channel: RTCDataChannel | null) {
    if (channel?.readyState !== "open" || channel.bufferedAmount === 0) return;
    await new Promise<void>((resolve) => {
      const previousThreshold = channel.bufferedAmountLowThreshold;
      let timeout: ReturnType<typeof setTimeout>;
      const finish = () => {
        clearTimeout(timeout);
        channel.removeEventListener("bufferedamountlow", finish);
        channel.bufferedAmountLowThreshold = previousThreshold;
        resolve();
      };
      channel.bufferedAmountLowThreshold = 0;
      channel.addEventListener("bufferedamountlow", finish, { once: true });
      timeout = setTimeout(finish, 150);
      if (channel.bufferedAmount === 0) finish();
    });
  }
}
