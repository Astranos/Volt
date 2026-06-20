import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_CONTROL_CHANNEL_LABEL,
  SCANNER_ICE_GATHERING_TIMEOUT_MS,
  SCANNER_STUN_ONLY_ICE_SERVERS,
} from "@volt/scanner-protocol";
import type { ScannerIceServer } from "@volt/scanner-protocol";
import type { JoinWindow } from "./mobile-scanner-signal-client";
import type { MobileScannerSignalClient } from "./mobile-scanner-signal-client";

export type PeerSession = {
  answerApplied: boolean;
  control: RTCDataChannel | null;
  id: string;
  pc: RTCPeerConnection;
  photoTransfer: RTCDataChannel | null;
  ready: boolean;
};

export type PeerConnectionEvents = {
  configureControlChannel: (peer: PeerSession, channel: RTCDataChannel) => void;
  configurePhotoChannel: (peer: PeerSession, channel: RTCDataChannel) => void;
  onPeerConnected: (peer: PeerSession) => void;
  onPeerDisconnected: (peer: PeerSession) => void;
  log?: (...args: unknown[]) => void;
};

export class MobileScannerPeerConnections {
  readonly peers = new Map<string, PeerSession>();

  private readonly signalClient: MobileScannerSignalClient;
  private readonly events: PeerConnectionEvents;

  constructor(signalClient: MobileScannerSignalClient, events: PeerConnectionEvents) {
    this.signalClient = signalClient;
    this.events = events;
  }

  async createPeerOffer(joinWindow: JoinWindow, joinAttemptId: string) {
    this.events.log?.("[Volt Scanner Pairing] creating WebRTC offer", { joinAttemptId });
    const iceServers = await this.resolveIceServers(joinAttemptId);
    const pc = new RTCPeerConnection({ iceServers });
    const peer: PeerSession = {
      answerApplied: false,
      control: null,
      id: joinAttemptId,
      pc,
      photoTransfer: null,
      ready: false,
    };
    this.peers.set(joinAttemptId, peer);

    peer.control = pc.createDataChannel(SCANNER_CONTROL_CHANNEL_LABEL, { ordered: true });
    peer.photoTransfer = pc.createDataChannel(PHOTO_TRANSFER_CHANNEL_LABEL, { ordered: true });
    this.events.configureControlChannel(peer, peer.control);
    this.events.configurePhotoChannel(peer, peer.photoTransfer);

    pc.onconnectionstatechange = () => {
      this.events.log?.("[Volt Scanner Pairing] peer connection state", {
        joinAttemptId,
        state: pc.connectionState,
        ready: peer.ready,
      });
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        this.events.onPeerDisconnected(peer);
      } else if (pc.connectionState === "connected" && peer.ready) {
        this.events.onPeerConnected(peer);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitForIceGathering(pc);
    if (!pc.localDescription) throw new Error("Failed to create scanner offer");

    await this.signalClient.postPeerOffer(joinWindow, joinAttemptId, pc.localDescription);
    this.events.log?.("[Volt Scanner Pairing] WebRTC offer posted", { joinAttemptId });
  }

  private async resolveIceServers(joinAttemptId: string): Promise<ScannerIceServer[]> {
    try {
      const iceServers = await this.signalClient.fetchIceServers();
      this.events.log?.("[Volt Scanner Pairing] fetched ICE servers", {
        joinAttemptId,
        count: iceServers.length,
      });
      return iceServers;
    } catch (error) {
      this.events.log?.("[Volt Scanner Pairing] falling back to STUN-only ICE servers", {
        joinAttemptId,
        error,
      });
      return SCANNER_STUN_ONLY_ICE_SERVERS;
    }
  }

  async applyPeerAnswer(joinAttemptId: string, answer: RTCSessionDescriptionInit) {
    const peer = this.peers.get(joinAttemptId);
    if (!peer || peer.answerApplied) return;
    await peer.pc.setRemoteDescription(answer);
    peer.answerApplied = true;
    this.events.log?.("[Volt Scanner Pairing] WebRTC answer applied", { joinAttemptId });
  }

  closePeer(joinAttemptId: string) {
    const peer = this.peers.get(joinAttemptId);
    if (!peer) return null;
    this.peers.delete(joinAttemptId);
    peer.control?.close();
    peer.photoTransfer?.close();
    peer.pc.close();
    return peer;
  }

  clear() {
    for (const peer of this.peers.values()) {
      peer.control?.close();
      peer.photoTransfer?.close();
      peer.pc.close();
    }
    this.peers.clear();
  }

  countConnectedPeers() {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.ready) count += 1;
    }
    return count;
  }

  private waitForIceGathering(pc: RTCPeerConnection) {
    return new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          pc.onicegatheringstatechange = null;
          resolve();
        }
      };
      setTimeout(resolve, SCANNER_ICE_GATHERING_TIMEOUT_MS);
    });
  }
}
