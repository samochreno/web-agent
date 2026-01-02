import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MicVAD,
  type RealTimeVADOptions,
  utils as vadUtils,
} from "@ricky0123/vad-web";

type VoicePhase = "idle" | "preparing" | "listening" | "thinking" | "stopping";

type Props = {
  onTranscription: (text: string) => Promise<void> | void;
};

function audioToWavBlob(audio: Float32Array): Blob {
  if (!audio || audio.length === 0) {
    throw new Error("Audio data is empty");
  }
  console.log("[WAV] Encoding audio, length:", audio.length, "samples");
  // encodeWAV params: (samples, format, sampleRate, numChannels, bitDepth)
  // format 1 = PCM integer, bitDepth 16 for standard 16-bit PCM
  const wavBuffer = vadUtils.encodeWAV(audio, 1, 16000, 1, 16);
  console.log("[WAV] Encoded buffer size:", wavBuffer.byteLength);
  return new Blob([wavBuffer], { type: "audio/wav" });
}

async function transcribeAudio(audio: Float32Array): Promise<string> {
  if (!audio || audio.length === 0) {
    throw new Error("No audio data to transcribe");
  }
  const wav = audioToWavBlob(audio);
  const form = new FormData();
  form.append("file", wav, "speech.wav");

  const response = await fetch("/api/transcriptions", {
    method: "POST",
    body: form,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to transcribe audio");
  }

  if (!payload.text) {
    throw new Error("Empty transcription");
  }

  return payload.text;
}

export function useVoiceMode({ onTranscription }: Props) {
  const [phase, setPhaseRaw] = useState<VoicePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const vadRef = useRef<MicVAD | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  const setPhase = useCallback((newPhase: VoicePhase, context?: string) => {
    console.log(`[VAD] Phase: ${newPhase}${context ? ` (${context})` : ""}`);
    setPhaseRaw(newPhase);
  }, []);

  const startVAD = useCallback(async () => {
    if (phase !== "idle") return;
    setError(null);
    setPhase("preparing", "startVAD called");

    try {
      // First, request mic permission - this triggers the browser prompt
      console.log("[VAD] Requesting microphone permission...");
      const tempStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      // Stop the temp stream immediately, we just needed to get permission
      tempStream.getTracks().forEach((track) => track.stop());
      console.log("[VAD] Microphone permission granted!");

      // Now we can list devices with their labels
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      console.log("[VAD] Available microphones:");
      audioInputs.forEach((d, i) => {
        console.log(
          `  ${i}: ${d.label || "Unknown"} (${d.deviceId.slice(0, 8)}...)`
        );
      });

      // Use the default device, or you can hardcode a deviceId here
      // const preferredDeviceId = audioInputs[0]?.deviceId; // Change index to pick different mic
      const preferredDeviceId: string | undefined = undefined; // undefined = system default

      if (preferredDeviceId) {
        console.log(
          "[VAD] Using device:",
          preferredDeviceId
        );
      } else {
        console.log("[VAD] Using system default microphone");
      }

      // const assetBase =
      //   "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/";
      const vadAssetBase =
        "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/";
      const ortWasmBase =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
      console.log("[VAD] Creating MicVAD instance...");
      const vad = await MicVAD.new({
        startOnLoad: false,
        // baseAssetPath: assetBase,
        // onnxWASMBasePath: assetBase,

        baseAssetPath: vadAssetBase,
        onnxWASMBasePath: ortWasmBase,

        // Specify which microphone to use
        additionalAudioConstraints: preferredDeviceId
          ? { deviceId: { exact: preferredDeviceId } }
          : undefined,

        processorType: "AudioWorklet",
        submitUserSpeechOnPause: true,
        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.35,
        preSpeechPadMs: 200,
        minSpeechMs: 250,
        onSpeechEnd: async (audio) => {
          console.log(
            "[VAD] onSpeechEnd triggered, audio length:",
            audio.length
          );
          setPhase("thinking", "onSpeechEnd");
          try {
            const text = await transcribeAudio(audio);
            console.log("[VAD] Transcription result:", text);
            await onTranscription(text);
            setLastUpdate(Date.now());
            setPhase("listening", "transcription complete");
          } catch (err) {
            console.error("[VAD] Transcription error:", err);
            setError(err instanceof Error ? err.message : String(err));
            setPhase("listening", "transcription error");
          }
        },
        onSpeechStart: () => {
          console.log("[VAD] onSpeechStart triggered");
          setPhase("listening", "onSpeechStart");
        },
        onVADMisfire: () => {
          console.log("[VAD] onVADMisfire - speech was too short");
        },
        onFrameProcessed: (probabilities, audioFrame) => {
          // Calculate RMS (root mean square) to check actual audio level
          let sum = 0;
          for (let i = 0; i < audioFrame.length; i++) {
            sum += audioFrame[i] * audioFrame[i];
          }
          const rms = Math.sqrt(sum / audioFrame.length);
          const maxSample = Math.max(...audioFrame.map(Math.abs));

          // Log more frequently to debug
          if (Math.random() < 0.1) {
            console.log(
              `[VAD] prob: ${probabilities.isSpeech.toFixed(
                3
              )}, RMS: ${rms.toFixed(5)}, max: ${maxSample.toFixed(4)}`
            );
          }

          // Warn if audio seems silent
          if (rms < 0.001 && Math.random() < 0.01) {
            console.warn("[VAD] ⚠️ Audio level very low - check microphone!");
          }
        },
      } as Partial<RealTimeVADOptions>);

      console.log("[VAD] MicVAD instance created, starting...");
      vadRef.current = vad;
      await vad.start();
      console.log("[VAD] MicVAD started successfully");
      setPhase("listening", "vad started");
    } catch (err) {
      console.error("[VAD] Error starting VAD:", err);
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle", "start error");
    }
  }, [onTranscription, phase, setPhase]);

  const stopVAD = useCallback(async () => {
    if (!vadRef.current) return;
    setPhase("stopping", "stopVAD called");
    try {
      console.log("[VAD] Pausing...");
      await vadRef.current.pause();
      console.log("[VAD] Destroying...");
      await vadRef.current.destroy();
      vadRef.current = null;
      console.log("[VAD] Stopped successfully");
    } catch (err) {
      console.error("[VAD] Error stopping:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase("idle", "stopped");
    }
  }, [setPhase]);

  const toggle = useCallback(async () => {
    if (phase === "idle") {
      await startVAD();
    } else {
      await stopVAD();
    }
  }, [phase, startVAD, stopVAD]);

  useEffect(() => {
    return () => {
      void stopVAD();
    };
  }, [stopVAD]);

  const label = useMemo(() => {
    switch (phase) {
      case "preparing":
        return "Preparing mic…";
      case "listening":
        return "Voice mode: listening";
      case "thinking":
        return "Transcribing…";
      case "stopping":
        return "Stopping…";
      default:
        return "Voice mode off";
    }
  }, [phase]);

  return {
    active: phase !== "idle" && phase !== "stopping",
    phase,
    error,
    label,
    lastUpdate,
    toggle,
  };
}
