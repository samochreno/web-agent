import type { RefObject } from "react";

export type RealtimeConnectionOptions = {
  apiBase: string;
  clientSecret: string;
  audioElement: RefObject<HTMLAudioElement | null>;
  preferredCodec?: string;
  abortSignal?: AbortSignal;
};

export type RealtimeConnection = {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
};

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  success: (stream: MediaStream) => void,
  failure: (error: DOMException) => void
) => void;

type LegacyNavigator = Navigator & {
  webkitGetUserMedia?: LegacyGetUserMedia;
  mozGetUserMedia?: LegacyGetUserMedia;
  msGetUserMedia?: LegacyGetUserMedia;
};

const getMicrophoneStream = async (): Promise<MediaStream> => {
  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices?.getUserMedia) {
    console.log(
      "RealtimeConnection: requesting microphone stream via navigator.mediaDevices"
    );
    return mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
  }

  const legacyNavigator = navigator as LegacyNavigator;
  const legacyGetUserMedia =
    legacyNavigator.webkitGetUserMedia ??
    legacyNavigator.mozGetUserMedia ??
    legacyNavigator.msGetUserMedia;

  if (!legacyGetUserMedia) {
    throw new Error("Microphone capture is not supported by this environment.");
  }

  console.log("RealtimeConnection: falling back to legacy getUserMedia");
  return new Promise<MediaStream>((resolve, reject) => {
    legacyGetUserMedia.call(
      navigator,
      { audio: true },
      resolve,
      reject as (err: DOMException) => void
    );
  });
};

export async function createRealtimeConnection({
  apiBase,
  clientSecret,
  audioElement,
  preferredCodec = "opus",
  abortSignal,
}: RealtimeConnectionOptions): Promise<RealtimeConnection> {
  if (abortSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const pc = new RTCPeerConnection();

  pc.ontrack = (event) => {
    if (audioElement.current) {
      audioElement.current.srcObject = event.streams[0];
    }
  };

  const mediaStream = await getMicrophoneStream();
  const trackInfo = mediaStream.getAudioTracks().map((t) => ({
    id: t.id,
    enabled: t.enabled,
    muted: t.muted,
    settings: t.getSettings(),
  }));
  console.log("RealtimeConnection: microphone stream tracked", {
    tracks: trackInfo,
  });
  if (abortSignal?.aborted) {
    mediaStream.getTracks().forEach((track) => track.stop());
    pc.close();
    throw new DOMException("Aborted", "AbortError");
  }
  const [microphoneTrack] = mediaStream.getAudioTracks();
  if (!microphoneTrack) {
    throw new Error("Microphone unavailable");
  }
  // Reinforce capture settings for WKWebView: keep a single mono track with AGC/NS enabled.
  try {
    await microphoneTrack.applyConstraints({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
    });
    console.log("RealtimeConnection: applied constraints to microphone track");
  } catch (err) {
    console.warn("RealtimeConnection: applyConstraints failed", err);
  }
  console.log(
    "RealtimeConnection: adding microphone track",
    microphoneTrack.enabled,
    microphoneTrack.muted
  );
  try {
    pc.addTrack(microphoneTrack, mediaStream);
    console.log(
      "RealtimeConnection: microphone track added to RTCPeerConnection"
    );
  } catch (err) {
    console.error("RealtimeConnection: failed to add microphone track", err);
    throw err;
  }

  const capabilities = RTCRtpSender.getCapabilities("audio");
  if (capabilities) {
    const codec = capabilities.codecs.find(
      (c) =>
        c.mimeType.toLowerCase() === `audio/${preferredCodec.toLowerCase()}`
    );
    if (codec && pc.getTransceivers()[0]) {
      pc.getTransceivers()[0].setCodecPreferences([codec]);
    }
  }

  const dc = pc.createDataChannel("oai-events");

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  if (abortSignal?.aborted) {
    dc.close();
    pc.getSenders().forEach((sender) => sender.track?.stop());
    pc.close();
    throw new DOMException("Aborted", "AbortError");
  }

  const normalizedBase = apiBase.replace(/\/$/, "");
  const sdpResponse = await fetch(`${normalizedBase}/v1/realtime`, {
    method: "POST",
    body: offer.sdp ?? undefined,
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp",
      "OpenAI-Beta": "realtime=v1",
    },
    signal: abortSignal,
  });

  if (abortSignal?.aborted) {
    dc.close();
    pc.getSenders().forEach((sender) => sender.track?.stop());
    pc.close();
    throw new DOMException("Aborted", "AbortError");
  }

  const answerSdp = await sdpResponse.text();
  const answer: RTCSessionDescriptionInit = { type: "answer", sdp: answerSdp };
  await pc.setRemoteDescription(answer);

  return { pc, dc };
}
