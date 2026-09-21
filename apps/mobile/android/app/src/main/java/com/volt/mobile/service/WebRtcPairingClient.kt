package com.volt.mobile.service

import android.content.Context
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.*
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class WebRtcPairingClient(
    context: Context,
    private val contributorId: String,
    private val chromeSessionId: String,
    private val onState: (State) -> Unit,
    private val onMessage: (String) -> Unit,
) : AutoCloseable {
    enum class State { Connected, Closed, Failed }
    private val factory: PeerConnectionFactory
    private var peer: PeerConnection? = null
    private var controlChannel: DataChannel? = null
    private var photoChannel: DataChannel? = null
    private var iceGatheringComplete = CompletableDeferred<Unit>()
    private val helloSent = AtomicBoolean(false)
    init { PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context.applicationContext).createInitializationOptions()); factory = PeerConnectionFactory.builder().createPeerConnectionFactory() }
    suspend fun createAnswer(remoteOfferSdp: String, ice: ScannerProtocol.IceServerConfiguration): ScannerProtocol.SessionDescription {
        val servers = ice.iceServers.map { server -> PeerConnection.IceServer.builder(server.urls).setUsername(server.username.orEmpty()).setPassword(server.credential.orEmpty()).createIceServer() }
        val connection = factory.createPeerConnection(PeerConnection.RTCConfiguration(servers), observer) ?: throw ScannerPairingError.CouldNotCreatePeer
        peer = connection
        val offer = ScannerProtocol.decodePairingPayload(remoteOfferSdp)
        setRemote(connection, SessionDescription(SessionDescription.Type.OFFER, offer.sdp))
        val answer = createAnswer(connection); setLocal(connection, answer)
        withTimeoutOrNull(ScannerProtocol.iceGatheringTimeoutMs) { iceGatheringComplete.await() }
        val localSdp = connection.localDescription?.description ?: throw ScannerPairingError.MissingAnswer
        return ScannerProtocol.SessionDescription("answer", localSdp)
    }
    fun send(message: String): Boolean = send(controlChannel, message)
    override fun close() { controlChannel?.close(); photoChannel?.close(); peer?.close(); factory.dispose(); controlChannel = null; photoChannel = null; peer = null; onState(State.Closed) }
    // A dedicated photo data channel is intentionally future work.
    private fun observeControl(c: DataChannel) { c.registerObserver(object : DataChannel.Observer { override fun onBufferedAmountChange(previousAmount: Long) = Unit; override fun onStateChange() { if (c.state() == DataChannel.State.OPEN && helloSent.compareAndSet(false, true)) { if (send(c, ScannerProtocol.encode(ScannerProtocol.hello(contributorId, chromeSessionId)))) onState(State.Connected) else onState(State.Failed) } }; override fun onMessage(buffer: DataChannel.Buffer) { if (!buffer.binary) { val bytes = ByteArray(buffer.data.remaining()); buffer.data.get(bytes); onMessage(String(bytes)) } } }) }
    private fun observePhoto(c: DataChannel) { c.registerObserver(object : DataChannel.Observer { override fun onBufferedAmountChange(previousAmount: Long) = Unit; override fun onStateChange() = Unit; override fun onMessage(buffer: DataChannel.Buffer) = Unit }) }
    private fun send(channel: DataChannel?, message: String): Boolean { val c = channel ?: return false; if (c.state() != DataChannel.State.OPEN) return false; return c.send(DataChannel.Buffer(ByteBuffer.wrap(message.toByteArray()), false)) }
    private val observer = object : PeerConnection.Observer { override fun onDataChannel(c: DataChannel) { when (c.label()) { ScannerProtocol.controlChannel -> { controlChannel = c; observeControl(c) }; ScannerProtocol.photoTransferChannel -> { photoChannel = c; observePhoto(c) }; else -> c.close() } }; override fun onConnectionChange(s: PeerConnection.PeerConnectionState) { when (s) { PeerConnection.PeerConnectionState.CLOSED -> onState(State.Closed); PeerConnection.PeerConnectionState.FAILED, PeerConnection.PeerConnectionState.DISCONNECTED -> onState(State.Failed); else -> Unit } }; override fun onSignalingChange(s: PeerConnection.SignalingState)=Unit; override fun onIceConnectionChange(s: PeerConnection.IceConnectionState)=Unit; override fun onIceConnectionReceivingChange(v:Boolean)=Unit; override fun onIceGatheringChange(s:PeerConnection.IceGatheringState) { if (s == PeerConnection.IceGatheringState.COMPLETE) iceGatheringComplete.complete(Unit) }; override fun onIceCandidate(c:IceCandidate)=Unit; override fun onIceCandidatesRemoved(c:Array<out IceCandidate>)=Unit; override fun onAddStream(s:MediaStream)=Unit; override fun onRemoveStream(s:MediaStream)=Unit; override fun onRenegotiationNeeded()=Unit; override fun onAddTrack(r:RtpReceiver, s:Array<out MediaStream>)=Unit }
    private suspend fun setRemote(p: PeerConnection, s: SessionDescription) = suspendCancellableCoroutine<Unit> { c -> p.setRemoteDescription(sdpObserver(c), s) }
    private suspend fun setLocal(p: PeerConnection, s: SessionDescription) = suspendCancellableCoroutine<Unit> { c -> p.setLocalDescription(sdpObserver(c), s) }
    private suspend fun createAnswer(p: PeerConnection) = suspendCancellableCoroutine<SessionDescription> { c -> p.createAnswer(object : SdpObserver { override fun onCreateSuccess(s: SessionDescription) = c.resume(s); override fun onCreateFailure(e:String)=c.resumeWithException(ScannerPairingError.MissingAnswer); override fun onSetSuccess()=Unit; override fun onSetFailure(e:String)=Unit }, MediaConstraints()) }
    private fun sdpObserver(c: kotlin.coroutines.Continuation<Unit>) = object : SdpObserver { override fun onSetSuccess()=c.resume(Unit); override fun onSetFailure(e:String)=c.resumeWithException(ScannerPairingError.CouldNotCreatePeer); override fun onCreateSuccess(s:SessionDescription)=Unit; override fun onCreateFailure(e:String)=Unit }
}
