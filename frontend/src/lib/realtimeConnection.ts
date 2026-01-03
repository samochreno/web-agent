import type { RefObject } from "react";

export type RealtimeConnectionOptions = {
  apiBase: string;
  clientSecret: string;
  audioElement: RefObject<HTMLAudioElement | null>;
  preferredCodec?: string;
};

export type RealtimeConnection = {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
};

export async function createRealtimeConnection({
  apiBase,
  clientSecret,
  audioElement,
  preferredCodec = "opus",
}: RealtimeConnectionOptions): Promise<RealtimeConnection> {
  const pc = new RTCPeerConnection();

  pc.ontrack = (event) => {
    if (audioElement.current) {
      audioElement.current.srcObject = event.streams[0];
    }
  };

  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
  });
  const [microphoneTrack] = mediaStream.getAudioTracks();
  if (!microphoneTrack) {
    throw new Error("Microphone unavailable");
  }
  pc.addTrack(microphoneTrack);

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

  const normalizedBase = apiBase.replace(/\/$/, "");
  const sdpResponse = await fetch(`${normalizedBase}/v1/realtime`, {
    method: "POST",
    body: offer.sdp ?? undefined,
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp",
      "OpenAI-Beta": "realtime=v1",
    },
  });

  const answerSdp = await sdpResponse.text();
  const answer: RTCSessionDescriptionInit = { type: "answer", sdp: answerSdp };
  await pc.setRemoteDescription(answer);

  return { pc, dc };
}
