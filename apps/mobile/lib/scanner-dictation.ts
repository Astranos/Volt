import * as Haptics from "expo-haptics";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useCallback, useRef, useState } from "react";
import { createId } from "./scanner-ids";

type DictationPhase = "partial" | "final" | "stopped";

type DictationSender = (message: {
  phase: DictationPhase;
  sessionId: string;
  text?: string;
}) => void;

type UseScannerDictationOptions = {
  connected: boolean;
  dictationPunctuation: boolean;
  sendDictation: DictationSender;
};

export function useScannerDictation({
  connected,
  dictationPunctuation,
  sendDictation,
}: UseScannerDictationOptions) {
  const [dictating, setDictating] = useState(false);
  const [dictationStarting, setDictationStarting] = useState(false);
  const [dictationTranscript, setDictationTranscript] = useState("");
  const [dictationError, setDictationError] = useState<string | null>(null);

  const lastDictationRef = useRef("");
  const lastDictationPartialRef = useRef("");
  const dictationSessionIdRef = useRef<string | null>(null);
  const dictationPermissionGrantedRef = useRef(false);
  const dictationRequestedRef = useRef(false);
  const dictationStopRequestedRef = useRef(false);

  const sendDictationText = useCallback((text: string, phase: "partial" | "final") => {
    const value = text.trim();
    if (!value) return;
    const sessionId = dictationSessionIdRef.current ?? createId("dictation");
    dictationSessionIdRef.current = sessionId;
    if (phase === "partial") {
      if (value === lastDictationPartialRef.current) return;
      lastDictationPartialRef.current = value;
    } else {
      if (value === lastDictationRef.current) return;
      lastDictationRef.current = value;
    }
    sendDictation({ phase, sessionId, text: value });
  }, [sendDictation]);

  useSpeechRecognitionEvent("start", () => {
    if (!dictationRequestedRef.current) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    dictationStopRequestedRef.current = false;
    setDictationStarting(false);
    setDictating(true);
    setDictationError(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  });

  useSpeechRecognitionEvent("end", () => {
    if (dictationStopRequestedRef.current) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    dictationStopRequestedRef.current = false;
    dictationRequestedRef.current = false;
    setDictationStarting(false);
    setDictating(false);
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim() ?? "";
    setDictationTranscript(transcript);
    if (event.isFinal) sendDictationText(transcript, "final");
  });

  useSpeechRecognitionEvent("error", (event) => {
    dictationStopRequestedRef.current = false;
    dictationRequestedRef.current = false;
    setDictationStarting(false);
    setDictating(false);
    setDictationError(event.message || event.error);
  });

  const prepareDictation = useCallback(async () => {
    if (dictationPermissionGrantedRef.current) return;
    const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    dictationPermissionGrantedRef.current = permissions.granted;
    if (!permissions.granted) setDictationError("Microphone and speech recognition permissions are required.");
  }, []);

  const startDictation = useCallback(async () => {
    if (!connected) {
      setDictationStarting(false);
      dictationRequestedRef.current = false;
      setDictationError("Pair with Chrome before dictating.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!dictationPermissionGrantedRef.current) {
      await prepareDictation();
      if (!dictationPermissionGrantedRef.current) {
        setDictationStarting(false);
        dictationRequestedRef.current = false;
        return;
      }
    }
    dictationRequestedRef.current = true;
    dictationStopRequestedRef.current = false;
    lastDictationRef.current = "";
    lastDictationPartialRef.current = "";
    dictationSessionIdRef.current = createId("dictation");
    setDictationTranscript("");
    setDictationError(null);
    setDictationStarting(true);
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: true,
      addsPunctuation: dictationPunctuation,
    });
  }, [connected, dictationPunctuation, prepareDictation]);

  const stopDictation = useCallback(() => {
    dictationStopRequestedRef.current = true;
    dictationRequestedRef.current = false;
    setDictationStarting(false);
    if (dictationSessionIdRef.current) {
      sendDictation({ phase: "stopped", sessionId: dictationSessionIdRef.current });
    }
    ExpoSpeechRecognitionModule.stop();
  }, [sendDictation]);

  return {
    dictating,
    dictationError,
    dictationStarting,
    dictationTranscript,
    prepareDictation,
    startDictation,
    stopDictation,
  };
}
