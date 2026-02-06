"use client";

import { BrowserMultiFormatReader } from "@zxing/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../page.module.css";

type ScanState = "idle" | "running" | "error" | "success";

export default function QrScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [status, setStatus] = useState<ScanState>("idle");
  const [message, setMessage] = useState<string>(
    "카메라 접근을 허용하면 QR을 인식합니다.",
  );
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const stop = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    readerRef.current = null;
    setStatus("idle");
    setShowScanner(false);
  }, []);

  const start = useCallback(async () => {
    try {
      setShowScanner(true);
      setStatus("running");
      setMessage("QR 코드를 카메라에 비춰 주세요.");
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const backCamera =
        devices.find((d) =>
          /(back|rear|environment)/i.test(d.label ?? ""),
        ) ?? devices[0];
      const deviceId = backCamera?.deviceId;

      if (!videoRef.current) {
        throw new Error("video element not ready");
      }

      // Ensure camera permission and stream is active for autoplay on mobile
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
        audio: false,
      });
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      await videoRef.current.play();

      await reader.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        (result, error) => {
          if (result) {
            const text = result.getText();
            if (text.startsWith("http://") || text.startsWith("https://")) {
              setLastUrl(text);
              setStatus("success");
              setMessage("링크를 확인했습니다. 새 창으로 이동합니다.");
              window.open(text, "_blank", "noopener,noreferrer");
              stop();
            } else {
              setStatus("error");
              setMessage("QR에 링크가 포함되어 있지 않습니다.");
            }
          }
          if (error && (error as { name?: string }).name !== "NotFoundException") {
            console.warn(error);
          }
        },
      );
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage("카메라 접근 또는 QR 인식에 실패했습니다.");
    }
  }, [stop]);

  useEffect(() => () => void stop(), [stop]);

  return (
    <div className={styles.qrCard}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>QR 스캔 당첨 확인</div>
        <div className={styles.cardHint}>스캔 후 당첨 확인 페이지로 이동</div>
      </div>
      {!showScanner ? (
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={start}
        >
          QR 스캔 당첨 확인
        </button>
      ) : (
        <div className={styles.qrBody}>
          <div className={styles.qrPreview}>
            <video ref={videoRef} className={styles.qrVideo} />
            <div className={styles.qrFrame} />
          </div>
          <div className={styles.qrControls}>
            <p className={styles.qrMessage}>{message}</p>
            <div className={styles.qrButtons}>
              <button
                type="button"
                className={styles.button}
                onClick={stop}
              >
                스캔 중지
              </button>
            </div>
            {lastUrl ? (
              <p className={styles.qrLink}>
                마지막 링크: <span>{lastUrl}</span>
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
