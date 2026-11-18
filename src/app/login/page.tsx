"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  CheckCircle2,
  HelpCircle,
  X,
  ShieldCheck,
  LogOut,
  RotateCcw,
  Fingerprint,
} from "lucide-react";

type FlowPhase =
  | "splash"
  | "splash-fade"
  | "welcome"
  | "scanning-biometrics"
  | "exiting-scan"
  | "exiting-check"
  | "exiting-sheet"
  | "exiting-final";

type SheetView = "cards" | "credentials" | "settings";

// Contatos de suporte dos cartões "Ligar" e "Local". Deixe vazio para ocultar o cartão.
const SUPORTE_WHATSAPP = "5514998364338"; // DDI + DDD + número
const SUPORTE_LOCAL_URL = "https://share.google/PpOHdrAPqK2W523Z1"; // link do Google Maps da empresa

// Helpers for WebAuthn ArrayBuffer <-> Base64URL conversion
function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function LoginPage() {
  const router = useRouter();

  // Real Authentication & Biometric State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [enrollBiometrics, setEnrollBiometrics] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [infoBanner, setInfoBanner] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Saved user & device biometric state
  const [displayName, setDisplayName] = useState("Gestor");
  const [hasBiometricToken, setHasBiometricToken] = useState(false);
  const [hasWebAuthnHardware, setHasWebAuthnHardware] = useState(false);

  // Choreography & UI State
  const [phase, setPhase] = useState<FlowPhase>("splash");
  const [sheetView, setSheetView] = useState<SheetView>("cards");
  const [authMethod, setAuthMethod] = useState<"faceid" | "passcode">("faceid");
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  // O sistema usa apenas o tema claro (fundo branco) nesta tela.
  const isClassic = true;

  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }, []);

  const scheduleTimer = useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(fn, delay);
    timersRef.current.push(id);
    return id;
  }, []);

  const deriveFirstName = useCallback((savedName: string | null, savedEmail: string | null) => {
    if (savedName && savedName.trim().length > 0) {
      return savedName.trim().split(" ")[0];
    }
    if (savedEmail && savedEmail.includes("@")) {
      const prefix = savedEmail.split("@")[0].replace(/[._-]+/g, " ").trim();
      const firstWord = prefix.split(" ")[0];
      if (firstWord && firstWord.length > 1) {
        return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
      }
    }
    return "Gestor";
  }, []);

  // Load saved profile & check WebAuthn hardware support
  useEffect(() => {
    const savedEmail = localStorage.getItem("remembered_email");
    const savedName = localStorage.getItem("remembered_name");
    const savedBioToken = localStorage.getItem("sol_biometric_token");

    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
    setHasBiometricToken(Boolean(savedBioToken));
    setDisplayName(deriveFirstName(savedName, savedEmail));

    if (
      typeof window !== "undefined" &&
      window.PublicKeyCredential &&
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
    ) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then((available) => setHasWebAuthnHardware(available))
        .catch(() => setHasWebAuthnHardware(false));
    }
  }, [deriveFirstName]);

  useEffect(() => {
    const savedName = localStorage.getItem("remembered_name");
    if (!savedName && email.includes("@")) {
      setDisplayName(deriveFirstName(null, email));
    }
  }, [email, deriveFirstName]);

  // Phase 1 -> Phase 2 Intro Sequence
  const startIntroSequence = useCallback(() => {
    clearAllTimers();
    setSheetView("cards");
    setError("");
    setInfoBanner("");
    setHelpModalOpen(false);
    setPhase("splash");

    scheduleTimer(() => {
      setPhase("splash-fade");
    }, 1850);

    scheduleTimer(() => {
      setPhase("welcome");
    }, 2300);
  }, [clearAllTimers, scheduleTimer]);

  useEffect(() => {
    startIntroSequence();
    return () => clearAllTimers();
  }, [startIntroSequence, clearAllTimers]);

  // Register real WebAuthn Platform Authenticator (Face ID / Touch ID / Windows Hello)
  const registerDeviceWebAuthn = async (userId: string, userEmail: string, userName: string) => {
    if (!hasWebAuthnHardware || typeof window === "undefined" || !navigator.credentials) {
      return false;
    }
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const userIdBytes = new TextEncoder().encode(userId);

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: "Soluções Financeiras",
            id: window.location.hostname,
          },
          user: {
            id: userIdBytes,
            name: userEmail,
            displayName: userName || userEmail,
          },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" },
            { alg: -257, type: "public-key" },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "preferred",
          },
          timeout: 45000,
        },
      })) as PublicKeyCredential | null;

      if (credential && credential.rawId) {
        const credId = bufferToBase64Url(credential.rawId);
        localStorage.setItem("sol_webauthn_cred_id", credId);
        return true;
      }
    } catch {
      // Fallback to signed biometricToken if user skips OS prompt
    }
    return false;
  };

  // Verify real WebAuthn Platform Authenticator
  const verifyDeviceWebAuthn = async (): Promise<boolean> => {
    const savedCredId = localStorage.getItem("sol_webauthn_cred_id");
    if (!hasWebAuthnHardware || !savedCredId || typeof window === "undefined" || !navigator.credentials) {
      return true;
    }

    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const rawIdBytes = base64UrlToUint8Array(savedCredId);

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [
            {
              id: rawIdBytes.buffer as ArrayBuffer,
              type: "public-key",
              transports: ["internal"],
            },
          ],
          userVerification: "required",
          timeout: 45000,
        },
      });

      return Boolean(assertion);
    } catch {
      return false;
    }
  };

  // Video Exit Choreography followed by real navigation
  const playExitChoreographyAndRedirect = useCallback(
    (alreadyScanning = false) => {
      clearAllTimers();
      setSheetView("cards");
      setHelpModalOpen(false);

      const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;

      if (isDesktop) {
        setPhase("exiting-check");

        scheduleTimer(() => {
          setPhase("exiting-sheet");
        }, 540);

        scheduleTimer(() => {
          setPhase("exiting-final");
        }, 1040);

        scheduleTimer(() => {
          router.push("/");
          router.refresh();
        }, 1420);
        return;
      }

      setPhase("exiting-scan");

      const scanDuration = alreadyScanning ? 380 : 680;

      scheduleTimer(() => {
        setPhase("exiting-check");
      }, scanDuration);

      scheduleTimer(() => {
        setPhase("exiting-sheet");
      }, scanDuration + 540);

      scheduleTimer(() => {
        setPhase("exiting-final");
      }, scanDuration + 1040);

      scheduleTimer(() => {
        router.push("/");
        router.refresh();
      }, scanDuration + 1420);
    },
    [clearAllTimers, router, scheduleTimer]
  );

  // 1. REAL BIOMETRIC / FACE ID LOGIN FLOW
  const handleFaceIdCardClick = async () => {
    if (phase !== "welcome" || isLoading) return;
    setError("");
    setInfoBanner("");

    const savedBioToken = localStorage.getItem("sol_biometric_token");

    if (savedBioToken) {
      setIsLoading(true);
      setPhase("scanning-biometrics");

      const bioVerified = await verifyDeviceWebAuthn();
      if (!bioVerified) {
        setIsLoading(false);
        setPhase("welcome");
        setAuthMethod("faceid");
        setSheetView("credentials");
        setError("Leitura biométrica cancelada. Confirme sua senha ou tente novamente.");
        return;
      }

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ biometricToken: savedBioToken, rememberMe: true }),
        });

        const data = await res.json();

        if (res.ok) {
          if (data?.biometricToken) {
            localStorage.setItem("sol_biometric_token", data.biometricToken);
          }
          if (data?.user?.name) {
            localStorage.setItem("remembered_name", data.user.name);
            setDisplayName(deriveFirstName(data.user.name, data.user.email));
          }
          setIsLoading(false);
          playExitChoreographyAndRedirect(true);
          return;
        } else {
          localStorage.removeItem("sol_biometric_token");
          setHasBiometricToken(false);
          setIsLoading(false);
          setPhase("welcome");
          setAuthMethod("faceid");
          setSheetView("credentials");
          setError(data.error || "Sua sessão Face ID expirou. Confirme sua senha para reativar.");
          return;
        }
      } catch {
        setIsLoading(false);
        setPhase("welcome");
        setAuthMethod("faceid");
        setSheetView("credentials");
        setError("Erro de conexão ao validar Face ID. Tente novamente.");
        return;
      }
    }

    if (email.trim() && password.trim()) {
      setAuthMethod("faceid");
      setEnrollBiometrics(true);
      await executePasswordLogin();
      return;
    }

    setAuthMethod("faceid");
    setEnrollBiometrics(true);
    setInfoBanner(
      "Faça login uma vez com seu e-mail e senha para ativar o acesso instantâneo via Face ID neste aparelho."
    );
    setSheetView("credentials");
    setTimeout(() => {
      if (!email.trim()) {
        emailInputRef.current?.focus();
      } else {
        passwordInputRef.current?.focus();
      }
    }, 180);
  };

  // 2. REAL EMAIL + PASSWORD LOGIN FLOW
  const executePasswordLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Preencha seu e-mail e senha para entrar.");
      return;
    }

    setIsLoading(true);
    setError("");
    setInfoBanner("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      });

      const data = await res.json();

      if (res.ok) {
        if (rememberMe) {
          localStorage.setItem("remembered_email", email.trim());
          if (data?.user?.name) {
            localStorage.setItem("remembered_name", data.user.name);
            setDisplayName(deriveFirstName(data.user.name, email));
          }
        } else {
          localStorage.removeItem("remembered_email");
        }

        const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
        if (isMobile && enrollBiometrics && data?.biometricToken) {
          localStorage.setItem("sol_biometric_token", data.biometricToken);
          setHasBiometricToken(true);
          if (authMethod === "faceid" && hasWebAuthnHardware && data?.user?.id) {
            await registerDeviceWebAuthn(
              String(data.user.id),
              String(data.user.email || email),
              String(data.user.name || displayName)
            );
          }
        }

        setIsLoading(false);
        playExitChoreographyAndRedirect(false);
      } else {
        setIsLoading(false);
        setError(data.error || "E-mail ou senha incorretos.");
      }
    } catch {
      setIsLoading(false);
      setError("Erro ao conectar ao servidor. Verifique sua conexão.");
    }
  };

  const handlePasscodeCardClick = () => {
    if (phase !== "welcome" || isLoading) return;
    setAuthMethod("passcode");
    setError("");
    setInfoBanner("");
    setSheetView("credentials");
    setTimeout(() => {
      if (!email.trim()) {
        emailInputRef.current?.focus();
      } else {
        passwordInputRef.current?.focus();
      }
    }, 180);
  };

  const handleUnlinkDevice = () => {
    localStorage.removeItem("sol_biometric_token");
    localStorage.removeItem("sol_webauthn_cred_id");
    localStorage.removeItem("remembered_email");
    localStorage.removeItem("remembered_name");
    setHasBiometricToken(false);
    setEmail("");
    setPassword("");
    setDisplayName("Gestor");
    setSheetView("cards");
  };

  const isSplash = phase === "splash" || phase === "splash-fade";
  const isScanningBio = phase === "scanning-biometrics";
  const isExitingScan = phase === "exiting-scan";
  const isExitingCheck = phase === "exiting-check";
  const isExitingSheet = phase === "exiting-sheet";
  const isExitingFinal = phase === "exiting-final";
  const isAnyExit = isExitingScan || isExitingCheck || isExitingSheet || isExitingFinal;

  // Biometric HUD only appears during active Face ID scan or authentication exit
  const showBiometricHud = isScanningBio || isExitingScan || isExitingCheck || isExitingSheet;
  const showDesktopCheckHud = isExitingCheck || isExitingSheet;

  return (
    <div
      className={`fixed inset-0 w-full h-[100dvh] overflow-hidden overscroll-none touch-manipulation flex items-center justify-center select-none font-sans transition-colors duration-300 ${
        isClassic ? "bg-[#059669]" : "bg-[#059669]"
      }`}
    >
      {/* ── App Screen Container (Full Viewport Mobile & Responsive Split Layout on PC) ── */}
      <div
        className={`relative z-10 w-full h-full overflow-hidden flex flex-col md:flex-row justify-between transition-colors duration-500 ${
          isExitingSheet
            ? "bg-[#064e3b]"
            : "bg-gradient-to-b md:bg-gradient-to-br from-[#059669] via-[#05875f] to-[#047857]"
        }`}
      >
        {/* ── Subtle 3D Topographic Wavy Texture on PC Emerald Hero ── */}
        <div className="pointer-events-none absolute inset-0 hidden md:block overflow-hidden opacity-35">
          <svg
            viewBox="0 0 1440 1024"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute inset-0 w-full h-full object-cover"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <linearGradient id="waveGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#065f46" />
                <stop offset="50%" stopColor="#047857" />
                <stop offset="100%" stopColor="#022c22" />
              </linearGradient>
              <linearGradient id="waveGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#047857" />
                <stop offset="50%" stopColor="#064e3b" />
                <stop offset="100%" stopColor="#011e17" />
              </linearGradient>
            </defs>
            {Array.from({ length: 14 }).map((_, idx) => {
              const offset = idx * 56 - 180;
              return (
                <path
                  key={idx}
                  d={`M ${-220 + offset} -80 C ${140 + offset} 180, ${40 + offset} 490, ${280 + offset} 740 C ${480 + offset} 950, ${760 + offset} 1020, ${980 + offset} 1120 L -300 1120 Z`}
                  fill={idx % 2 === 0 ? "url(#waveGrad1)" : "url(#waveGrad2)"}
                  stroke="rgba(110, 231, 183, 0.16)"
                  strokeWidth="1.2"
                />
              );
            })}
          </svg>
        </div>

        {/* Ambient Radial Highlight */}
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-500"
          style={{
            background:
              "radial-gradient(circle at 35% 28%, rgba(52, 211, 153, 0.28) 0%, transparent 62%)",
            opacity: isExitingSheet ? 0.3 : 1,
          }}
        />

        {/* ── Floating Biometric Face ID Scanner HUD (Mobile Only) ── */}
        <div className="pointer-events-none absolute inset-x-0 top-5 z-50 flex justify-center md:hidden">
          <div
            className={`bg-black/95 text-white shadow-[0_14px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/15 flex items-center justify-center overflow-hidden transition-all duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              showBiometricHud
                ? "w-[120px] h-[120px] rounded-[32px] scale-100 opacity-100 translate-y-0"
                : "w-[80px] h-[28px] rounded-full scale-75 opacity-0 -translate-y-6"
            }`}
          >
            {/* 3D Glowing Green Face ID Wireframe Scan */}
            {(isScanningBio || isExitingScan) && (
              <div className="relative w-16 h-16 flex items-center justify-center animate-fade-in">
                <div className="absolute inset-0 rounded-full bg-emerald-400/15 blur-md animate-pulse" />
                <svg
                  viewBox="0 0 64 64"
                  className="w-14 h-14 text-[#4ade80] animate-face-scan-3d"
                  fill="none"
                >
                  <ellipse
                    cx="32"
                    cy="32"
                    rx="26"
                    ry="26"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="6 4"
                    className="opacity-60"
                  />
                  <ellipse
                    cx="32"
                    cy="32"
                    rx="24"
                    ry="12"
                    transform="rotate(-28 32 32)"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="opacity-85"
                  />
                  <ellipse
                    cx="32"
                    cy="32"
                    rx="12"
                    ry="24"
                    transform="rotate(24 32 32)"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="opacity-85"
                  />
                  <path
                    d="M24 26V29M40 26V29M32 28V35H29M25 40C27.5 43 36.5 43 39 40"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}

            {/* Glowing Green Circle with Checkmark */}
            {(isExitingCheck || isExitingSheet) && (
              <div className="relative w-14 h-14 flex items-center justify-center animate-login-check-circle">
                <div className="absolute inset-0 rounded-full bg-[#4ade80]/20 blur-md" />
                <svg viewBox="0 0 56 56" className="w-13 h-13" fill="none">
                  <circle
                    cx="28"
                    cy="28"
                    r="22"
                    stroke="#4ade80"
                    strokeWidth="3"
                    className="opacity-95"
                  />
                  <path
                    d="M19.5 28.5L25.5 34.5L37.5 22.5"
                    stroke="#4ade80"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="animate-login-check-path"
                  />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* ── Desktop Confirmation Checkmark HUD (PC Only, No Face ID) ── */}
        <div className="pointer-events-none absolute inset-0 z-50 hidden md:flex items-center justify-center">
          <div
            className={`bg-[#022c22]/95 text-white shadow-[0_20px_60px_rgba(0,0,0,0.55)] ring-1 ring-emerald-300/30 backdrop-blur-xl flex flex-col items-center justify-center gap-3 overflow-hidden transition-all duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              showDesktopCheckHud
                ? "w-[164px] h-[164px] rounded-[38px] scale-100 opacity-100"
                : "w-[110px] h-[110px] rounded-[28px] scale-75 opacity-0"
            }`}
          >
            {showDesktopCheckHud && (
              <>
                <div className="relative w-16 h-16 flex items-center justify-center animate-login-check-circle">
                  <div className="absolute inset-0 rounded-full bg-[#4ade80]/25 blur-md" />
                  <svg viewBox="0 0 56 56" className="w-15 h-15" fill="none">
                    <circle
                      cx="28"
                      cy="28"
                      r="22"
                      stroke="#4ade80"
                      strokeWidth="3"
                      className="opacity-95"
                    />
                    <path
                      d="M19.5 28.5L25.5 34.5L37.5 22.5"
                      stroke="#4ade80"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="animate-login-check-path"
                    />
                  </svg>
                </div>
                <span className="text-xs font-bold tracking-wider uppercase text-emerald-200">
                  Acesso liberado
                </span>
              </>
            )}
          </div>
        </div>

        {/* =====================================================================
            PHASE 1: SPLASH SCREEN (Frames 05 -> 11)
           ===================================================================== */}
        {isSplash && (
          <div className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-full w-[112px] md:w-[148px] flex items-center justify-center">
                <div
                  className="h-[75%] w-[16px] md:w-[22px] bg-[#022c22] animate-splash-ribbon-up"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="h-[85%] w-[16px] md:w-[22px] bg-[#f59e0b] animate-splash-ribbon-up"
                  style={{ animationDelay: "65ms" }}
                />
                <div
                  className="h-[92%] w-[20px] md:w-[26px] bg-white animate-splash-ribbon-up"
                  style={{ animationDelay: "120ms" }}
                />
                <div
                  className="h-[82%] w-[18px] md:w-[24px] bg-[#6ee7b7] animate-splash-ribbon-up"
                  style={{ animationDelay: "175ms" }}
                />
                <div
                  className="h-[78%] w-[16px] md:w-[22px] bg-[#10b981] animate-splash-ribbon-up"
                  style={{ animationDelay: "225ms" }}
                />
                <div
                  className="h-[70%] w-[14px] md:w-[18px] bg-[#064e3b] animate-splash-ribbon-up"
                  style={{ animationDelay: "270ms" }}
                />
              </div>
            </div>

            <div
              className={`relative z-10 flex flex-col items-center gap-3 md:gap-4 px-6 text-center transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                phase === "splash-fade"
                  ? "opacity-0 scale-95 -translate-y-2"
                  : "opacity-100 scale-100 translate-y-0 animate-fade-in"
              }`}
              style={{ animationDelay: "360ms" }}
            >
              <div className="w-24 h-24 md:w-28 md:h-28 rounded-3xl md:rounded-[32px] bg-[#022c22]/90 border border-emerald-300/40 shadow-2xl shadow-black/35 p-3 md:p-4 flex items-center justify-center">
                <img
                  src="/logo-symbol.png"
                  alt="Soluções Financeiras"
                  className="w-full h-full object-contain scale-110 drop-shadow-md"
                />
              </div>
              <div className="flex flex-col text-white">
                <span className="text-[28px] md:text-[36px] font-black tracking-tight leading-none">
                  SOLUÇÕES
                </span>
                <span className="text-[13px] md:text-[15px] font-semibold text-emerald-100/90 tracking-widest uppercase mt-1.5">
                  Financeiras
                </span>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            PHASE 2 & 3: WELCOME / LOGIN SCREEN & EXIT CHOREOGRAPHY
           ===================================================================== */}
        {!isSplash && (
          <>
            {/* ── Continuous Curved Multi-Colored Ribbons in Background ── */}
            <div
              className={`pointer-events-none absolute inset-x-0 md:inset-x-auto md:left-0 top-0 md:w-[62%] lg:w-[58%] h-[380px] md:h-[520px] z-10 overflow-hidden transition-opacity duration-300 ${
                isAnyExit ? "opacity-0" : "opacity-100"
              }`}
            >
              <svg
                viewBox="0 0 392 340"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full"
                preserveAspectRatio="none"
              >
                <path
                  d="M 22 -20 L 22 142 A 96 96 0 0 0 118 238 L 420 238"
                  stroke="#022c22"
                  strokeWidth="13"
                  strokeLinecap="butt"
                  className="animate-curved-ribbon"
                  style={{ animationDelay: "0ms" }}
                />
                <path
                  d="M 35 -20 L 35 142 A 83 83 0 0 0 118 225 L 420 225"
                  stroke="#f59e0b"
                  strokeWidth="13"
                  strokeLinecap="butt"
                  className="animate-curved-ribbon"
                  style={{ animationDelay: "60ms" }}
                />
                <path
                  d="M 48 -20 L 48 142 A 70 70 0 0 0 118 212 L 420 212"
                  stroke="#ffffff"
                  strokeWidth="13"
                  strokeLinecap="butt"
                  className="animate-curved-ribbon"
                  style={{ animationDelay: "120ms" }}
                />
                <path
                  d="M 61 -20 L 61 142 A 57 57 0 0 0 118 199 L 420 199"
                  stroke="#6ee7b7"
                  strokeWidth="13"
                  strokeLinecap="butt"
                  className="animate-curved-ribbon"
                  style={{ animationDelay: "180ms" }}
                />
                <path
                  d="M 74 -20 L 74 142 A 44 44 0 0 0 118 186 L 420 186"
                  stroke="#064e3b"
                  strokeWidth="13"
                  strokeLinecap="butt"
                  className="animate-curved-ribbon"
                  style={{ animationDelay: "240ms" }}
                />
              </svg>
            </div>

            {/* ── Subtle "J" Curved Watermark Line on Final Exit ── */}
            {isExitingFinal && (
              <div className="pointer-events-none absolute inset-0 z-10 animate-fade-in">
                <svg viewBox="0 0 392 824" fill="none" className="w-full h-full">
                  <path
                    d="M 206 445 L 206 675 A 78 78 0 0 1 128 753 L 0 753"
                    stroke="rgba(167, 243, 208, 0.16)"
                    strokeWidth="16"
                  />
                </svg>
              </div>
            )}

            {/* ── Upper Hero Area (Mobile) / Left Brand Hero Column (PC) ── */}
            <div
              className="relative z-20 flex-1 flex flex-col justify-between px-6 pb-5 md:px-12 lg:px-16 xl:px-24 md:py-10 lg:py-12"
              style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
            >
              {/* Top-Right Action Buttons: Discreet Classic Restore Icon + Settings Gear Button */}
              <div
                className={`relative flex items-center justify-end gap-2 md:gap-2.5 transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isAnyExit
                    ? "opacity-0 -translate-y-3 pointer-events-none"
                    : "opacity-100 translate-y-0"
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setSheetView((prev) => (prev === "settings" ? "cards" : "settings"))
                  }
                  title="Configurações de acesso"
                  className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-[#022c22]/25 backdrop-blur-md border border-white/15 flex items-center justify-center text-white hover:bg-[#022c22]/40 active:scale-90 transition-all cursor-pointer animate-fade-in"
                  style={{ animationDelay: "220ms" }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="w-5 h-5"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  >
                    <circle cx="12" cy="12" r="3.2" />
                    <circle cx="12" cy="12" r="7.5" strokeOpacity="0.85" />
                    <path d="M12 2.2V4.5M12 19.5V21.8M2.2 12H4.5M19.5 12H21.8M5.07 5.07L6.7 6.7M17.3 17.3L18.93 18.93M18.93 5.07L17.3 6.7M6.7 17.3L5.07 18.93" />
                  </svg>
                </button>
              </div>

              {/* Centered Prominent Brand Logo occupying the central hero space */}
              <div
                className={`my-auto flex flex-col items-center justify-center text-center transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isAnyExit
                    ? "opacity-0 scale-90 pointer-events-none"
                    : "opacity-100 scale-100 animate-fade-in"
                }`}
                style={{ animationDelay: "120ms" }}
              >
                <div className="relative">
                  <div className="absolute -inset-3 md:-inset-5 rounded-full bg-emerald-300/20 blur-xl md:blur-2xl" />
                  <div className="relative w-20 h-20 md:w-28 md:h-28 lg:w-32 lg:h-32 rounded-[26px] md:rounded-[34px] bg-[#022c22]/85 backdrop-blur-md border border-emerald-300/35 shadow-[0_14px_34px_rgba(0,0,0,0.35)] p-2.5 md:p-4 flex items-center justify-center">
                    <img
                      src="/logo-symbol.png"
                      alt="Soluções Financeiras"
                      className="w-full h-full object-contain scale-110 drop-shadow"
                    />
                  </div>
                </div>
                <span className="mt-2.5 md:mt-4 text-xl md:text-3xl lg:text-4xl font-black tracking-tight text-white drop-shadow-xs leading-none">
                  SOLUÇÕES
                </span>
                <span className="mt-1 md:mt-1.5 text-[11px] md:text-xs lg:text-sm font-bold uppercase tracking-[0.18em] md:tracking-[0.22em] text-emerald-100/90 drop-shadow-xs">
                  Financeiras
                </span>
              </div>

              {/* Staggered Two-Line Greeting */}
              <div
                className={`transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isAnyExit
                    ? "opacity-0 -translate-y-4 pointer-events-none"
                    : "opacity-100 translate-y-0"
                }`}
              >
                <p
                  className="text-[26px] md:text-3xl lg:text-[38px] font-bold text-white/95 leading-[1.15] tracking-tight drop-shadow-xs animate-fade-in-up"
                  style={{ animationDelay: "80ms" }}
                >
                  Bem-vindo de volta,
                </p>
                <h1
                  className="text-[30px] md:text-4xl lg:text-[46px] font-black text-white leading-[1.12] tracking-tight mt-0.5 md:mt-1 drop-shadow-xs animate-fade-in-up"
                  style={{ animationDelay: "200ms" }}
                >
                  {displayName}
                </h1>
                <p
                  className="hidden md:block text-sm lg:text-base font-medium text-emerald-100/80 mt-2.5 max-w-md animate-fade-in-up"
                  style={{ animationDelay: "280ms" }}
                >
                  Gestão inteligente de capital, empréstimos e cobranças com máxima segurança.
                </p>
              </div>
            </div>

            {/* ── Asymmetric Bottom Sheet (Mobile) / Right Interactive Panel (PC) ── */}
            <div
              style={{
                paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
              }}
              className={`relative z-20 w-full md:w-[440px] lg:w-[500px] xl:w-[540px] 2xl:w-[580px] md:h-full rounded-tr-[42px] rounded-tl-none md:rounded-tr-none md:rounded-tl-[56px] px-6 pt-6 md:px-10 lg:px-12 md:py-10 flex flex-col justify-center transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                isClassic
                  ? "bg-white text-slate-900 shadow-[0_-16px_50px_rgba(15,23,42,0.18)] md:shadow-[-24px_0_60px_rgba(15,23,42,0.14)] border-t md:border-t-0 md:border-l border-emerald-100"
                  : "bg-[#12171d] text-white shadow-[0_-16px_50px_rgba(0,0,0,0.45)] md:shadow-[-24px_0_60px_rgba(0,0,0,0.5)] border-t md:border-t-0 md:border-l border-white/[0.06]"
              } ${
                isExitingSheet || isExitingFinal
                  ? "translate-y-[105%] md:translate-y-0 md:translate-x-[105%]"
                  : "translate-y-0 md:translate-x-0 animate-slide-up"
              }`}
            >
              <div className="w-full max-w-[420px] mx-auto">
                {/* Desktop Panel Header (PC Only) */}
                <div
                  className={`hidden md:flex items-center justify-between mb-6 pb-4 border-b transition-opacity duration-300 ${
                    isClassic ? "border-slate-100" : "border-white/[0.06]"
                  } ${isAnyExit ? "opacity-0" : "opacity-100"}`}
                >
                  <div>
                    <span
                      className={`text-xs font-extrabold uppercase tracking-[0.16em] ${
                        isClassic ? "text-emerald-700" : "text-emerald-400"
                      }`}
                    >
                      Portal de Acesso
                    </span>
                    <p
                      className={`text-sm font-medium mt-0.5 ${
                        isClassic ? "text-slate-500" : "text-slate-400"
                      }`}
                    >
                      {sheetView === "credentials"
                        ? "Informe seu e-mail e senha para entrar"
                        : sheetView === "settings"
                          ? "Preferências de aparência e sessão"
                          : "Acesse sua conta ou fale com nosso suporte"}
                    </p>
                  </div>
                  <div
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                      isClassic
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Seguro</span>
                  </div>
                </div>

                {sheetView === "cards" && (
                  /* =========================================================
                     VIEW A: THE SIGNATURE CARDS (Mobile: Face ID + Senha | PC: Senha Only)
                     ========================================================= */
                  <div>
                    <div className="grid grid-cols-2 md:grid-cols-1 gap-3.5">
                      {/* Left Card: REAL Face ID / Biometric Login (Mobile Only — Hidden on PC) */}
                      <button
                        type="button"
                        onClick={handleFaceIdCardClick}
                        disabled={isLoading}
                        style={{
                          transitionDelay: isExitingCheck ? "0ms" : "0ms",
                          animationDelay: "140ms",
                        }}
                        className={`md:hidden group relative h-[136px] rounded-[22px] p-4 flex flex-col justify-between text-left bg-gradient-to-br from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#059669] cursor-pointer active:scale-[0.97] transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                          isClassic
                            ? "shadow-lg shadow-emerald-600/25 border border-emerald-400/35"
                            : "shadow-lg shadow-emerald-950/50 border border-emerald-300/25"
                        } ${
                          isExitingCheck || isExitingSheet || isExitingFinal
                            ? "translate-y-36 opacity-0 pointer-events-none"
                            : "translate-y-0 opacity-100 animate-fade-in-up"
                        }`}
                      >
                        <div className="w-full flex items-center justify-between text-white">
                          <svg
                            viewBox="0 0 28 28"
                            fill="none"
                            className="w-7 h-7 transition-transform duration-300 group-hover:scale-105"
                            stroke="currentColor"
                            strokeWidth="2.1"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M8.5 3.5H6C4.61929 3.5 3.5 4.61929 3.5 6V8.5" />
                            <path d="M19.5 3.5H22C23.3807 3.5 24.5 4.61929 24.5 6V8.5" />
                            <path d="M8.5 24.5H6C4.61929 24.5 3.5 23.3807 3.5 22V19.5" />
                            <path d="M19.5 24.5H22C23.3807 24.5 24.5 23.3807 24.5 22V19.5" />
                            <path d="M10 10.5V12.5" />
                            <path d="M18 10.5V12.5" />
                            <path d="M14 11V15.2H12.6" />
                            <path d="M10.5 18.5C11.8 20.1 16.2 20.1 17.5 18.5" />
                          </svg>

                          {hasBiometricToken && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/25 text-[10px] font-bold text-emerald-100">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                              Ativo
                            </span>
                          )}
                        </div>

                        <div>
                          <span className="block text-[15px] font-bold text-white tracking-tight">
                            Face ID
                          </span>
                          <span className="block text-[11px] font-medium text-emerald-100/85 mt-0.5">
                            {hasBiometricToken
                              ? "Toque para entrar"
                              : "Ativar biometria"}
                          </span>
                        </div>
                      </button>

                      {/* Right Card on Mobile / Full-Width Primary Card on PC: Com Senha */}
                      <button
                        type="button"
                        onClick={handlePasscodeCardClick}
                        disabled={isLoading}
                        style={{
                          transitionDelay: isExitingCheck ? "150ms" : "0ms",
                          animationDelay: "220ms",
                        }}
                        className={`group relative h-[136px] md:h-[148px] rounded-[22px] md:rounded-[26px] p-4 md:p-6 flex flex-col justify-between text-left bg-gradient-to-br from-[#065f46] to-[#064e3b] md:from-[#10b981] md:via-[#059669] md:to-[#064e3b] hover:from-[#047857] hover:to-[#064e3b] md:hover:from-[#34d399] md:hover:to-[#059669] cursor-pointer active:scale-[0.98] transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                          isClassic
                            ? "shadow-lg shadow-emerald-950/20 md:shadow-emerald-600/25 border border-emerald-700/25 md:border-emerald-400/35"
                            : "shadow-lg shadow-black/40 md:shadow-emerald-950/50 border border-emerald-400/15 md:border-emerald-300/25"
                        } ${
                          isExitingCheck || isExitingSheet || isExitingFinal
                            ? "translate-y-36 opacity-0 pointer-events-none"
                            : "translate-y-0 opacity-100 animate-fade-in-up"
                        }`}
                      >
                        <div className="w-full flex items-center justify-between text-white">
                          <div className="w-9 h-9 md:w-11 md:h-11 md:rounded-2xl md:bg-black/15 md:border md:border-white/15 flex items-center justify-start md:justify-center">
                            <svg
                              viewBox="0 0 28 28"
                              fill="currentColor"
                              className="w-7 h-7 transition-transform duration-300 group-hover:scale-105"
                            >
                              <circle cx="7" cy="5.5" r="1.9" />
                              <circle cx="14" cy="5.5" r="1.9" />
                              <circle cx="21" cy="5.5" r="1.9" />
                              <circle cx="7" cy="11.5" r="1.9" />
                              <circle cx="14" cy="11.5" r="1.9" />
                              <circle cx="21" cy="11.5" r="1.9" />
                              <circle cx="7" cy="17.5" r="1.9" />
                              <circle cx="14" cy="17.5" r="1.9" />
                              <circle cx="21" cy="17.5" r="1.9" />
                              <circle cx="14" cy="23.5" r="1.9" />
                            </svg>
                          </div>

                          <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/20 border border-white/15 text-xs font-bold text-white group-hover:bg-black/30 transition-colors">
                            <span>Entrar agora</span>
                            <span>→</span>
                          </span>
                        </div>

                        <div>
                          <span className="block text-[15px] md:text-lg font-bold text-white tracking-tight">
                            Com Senha
                          </span>
                          <span className="block text-[11px] md:text-xs font-medium text-emerald-200/75 md:text-emerald-50/90 mt-0.5">
                            E-mail e senha
                          </span>
                        </div>
                      </button>
                    </div>

                    {/* "Fale conosco" Section + 3 Staggered Cards */}
                    <div className="mt-5 md:mt-7">
                      <div
                        className={`flex items-center justify-between mb-3 transition-all duration-300 ${
                          isAnyExit
                            ? "opacity-0 translate-y-2"
                            : "opacity-100 translate-y-0 animate-fade-in"
                        }`}
                        style={{ animationDelay: "300ms" }}
                      >
                        <h2
                          className={`text-[15px] md:text-base font-bold tracking-tight ${
                            isClassic ? "text-slate-900" : "text-white/95"
                          }`}
                        >
                          Fale conosco
                        </h2>
                        {email && (
                          <span
                            className={`text-[11px] md:text-xs font-medium truncate max-w-[180px] md:max-w-[240px] ${
                              isClassic ? "text-slate-500" : "text-slate-400"
                            }`}
                          >
                            {email}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-3 md:gap-3.5">
                        {SUPORTE_WHATSAPP && (
                          <a
                            href={`https://wa.me/${SUPORTE_WHATSAPP}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              transitionDelay: isAnyExit ? "0ms" : "0ms",
                              animationDelay: "360ms",
                            }}
                            className={`group h-[98px] md:h-[112px] rounded-[20px] md:rounded-[22px] p-3.5 md:p-4 flex flex-col justify-between text-left cursor-pointer active:scale-95 transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                              isClassic
                                ? "bg-slate-50 hover:bg-emerald-50/70 border border-slate-200/80 hover:border-emerald-200 shadow-xs"
                                : "bg-[#1c222b] hover:bg-[#232b36] border border-white/[0.05]"
                            } ${
                              isAnyExit
                                ? "translate-y-28 opacity-0 pointer-events-none"
                                : "translate-y-0 opacity-100 animate-fade-in-up"
                            }`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              className={`w-5 h-5 md:w-5.5 md:h-5.5 transition-colors ${
                                isClassic
                                  ? "text-emerald-700 group-hover:text-emerald-600"
                                  : "text-white/90 group-hover:text-emerald-400"
                              }`}
                              stroke="currentColor"
                              strokeWidth="1.9"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                            </svg>
                            <span
                              className={`text-[13px] md:text-sm font-semibold tracking-tight ${
                                isClassic
                                  ? "text-slate-800 group-hover:text-emerald-950"
                                  : "text-white/90"
                              }`}
                            >
                              Ligar
                            </span>
                          </a>
                        )}

                        {SUPORTE_LOCAL_URL && (
                          <a
                            href={SUPORTE_LOCAL_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              transitionDelay: isAnyExit ? "90ms" : "0ms",
                              animationDelay: "440ms",
                            }}
                            className={`group h-[98px] md:h-[112px] rounded-[20px] md:rounded-[22px] p-3.5 md:p-4 flex flex-col justify-between text-left cursor-pointer active:scale-95 transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                              isClassic
                                ? "bg-slate-50 hover:bg-emerald-50/70 border border-slate-200/80 hover:border-emerald-200 shadow-xs"
                                : "bg-[#1c222b] hover:bg-[#232b36] border border-white/[0.05]"
                            } ${
                              isAnyExit
                                ? "translate-y-28 opacity-0 pointer-events-none"
                                : "translate-y-0 opacity-100 animate-fade-in-up"
                            }`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              className={`w-5 h-5 md:w-5.5 md:h-5.5 transition-colors ${
                                isClassic
                                  ? "text-emerald-700 group-hover:text-emerald-600"
                                  : "text-white/90 group-hover:text-emerald-400"
                              }`}
                              stroke="currentColor"
                              strokeWidth="1.9"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
                              <line x1="9" y1="3" x2="9" y2="18" />
                              <line x1="15" y1="6" x2="15" y2="21" />
                            </svg>
                            <span
                              className={`text-[13px] md:text-sm font-semibold tracking-tight ${
                                isClassic
                                  ? "text-slate-800 group-hover:text-emerald-950"
                                  : "text-white/90"
                              }`}
                            >
                              Local
                            </span>
                          </a>
                        )}

                        {/* Card 3: Ajuda */}
                        <button
                          type="button"
                          onClick={() => setHelpModalOpen(true)}
                          style={{
                            transitionDelay: isAnyExit ? "180ms" : "0ms",
                            animationDelay: "520ms",
                          }}
                          className={`group h-[98px] md:h-[112px] rounded-[20px] md:rounded-[22px] p-3.5 md:p-4 flex flex-col justify-between text-left cursor-pointer active:scale-95 transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                            isClassic
                              ? "bg-slate-50 hover:bg-emerald-50/70 border border-slate-200/80 hover:border-emerald-200 shadow-xs"
                              : "bg-[#1c222b] hover:bg-[#232b36] border border-white/[0.05]"
                          } ${
                            isAnyExit
                              ? "translate-y-28 opacity-0 pointer-events-none"
                              : "translate-y-0 opacity-100 animate-fade-in-up"
                          }`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            className={`w-5 h-5 md:w-5.5 md:h-5.5 transition-colors ${
                              isClassic
                                ? "text-emerald-700 group-hover:text-emerald-600"
                                : "text-white/90 group-hover:text-emerald-400"
                            }`}
                            stroke="currentColor"
                            strokeWidth="2.1"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                          </svg>
                          <span
                            className={`text-[13px] md:text-sm font-semibold tracking-tight ${
                              isClassic
                                ? "text-slate-800 group-hover:text-emerald-950"
                                : "text-white/90"
                            }`}
                          >
                            Ajuda
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {sheetView === "credentials" && (
                  /* =========================================================
                     VIEW B: REAL CREDENTIALS FORM (16px font to prevent iOS zoom)
                     ========================================================= */
                  <form onSubmit={executePasswordLogin} className="space-y-3 md:space-y-4 animate-fade-in-up">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setSheetView("cards");
                          setError("");
                          setInfoBanner("");
                        }}
                        className={`inline-flex items-center gap-1.5 text-xs md:text-sm font-bold py-1 pr-2 cursor-pointer transition-colors ${
                          isClassic
                            ? "text-emerald-700 hover:text-emerald-600"
                            : "text-emerald-400 hover:text-emerald-300"
                        }`}
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Voltar</span>
                      </button>

                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                          isClassic
                            ? "text-emerald-800 bg-emerald-50 border-emerald-200"
                            : "text-emerald-300/90 bg-emerald-500/15 border-emerald-500/25"
                        }`}
                      >
                        <span className="md:hidden">
                          {authMethod === "faceid" ? "Vincular Face ID" : "Acesso com Senha"}
                        </span>
                        <span className="hidden md:inline">Acesso com Senha</span>
                      </span>
                    </div>

                    {infoBanner && !error && (
                      <div
                        className={`p-2.5 md:p-3 rounded-2xl border text-xs font-medium leading-relaxed ${
                          isClassic
                            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                            : "bg-emerald-500/10 border-emerald-500/25 text-emerald-200"
                        }`}
                      >
                        {infoBanner}
                      </div>
                    )}

                    {error && (
                      <div
                        className={`p-2.5 md:p-3 rounded-2xl border text-xs font-semibold flex items-center justify-between ${
                          isClassic
                            ? "bg-red-50 border-red-200 text-red-700"
                            : "bg-red-500/15 border-red-500/30 text-red-300"
                        }`}
                      >
                        <span>{error}</span>
                        <button
                          type="button"
                          onClick={() => setError("")}
                          className={`ml-2 ${
                            isClassic
                              ? "text-red-500 hover:text-red-700"
                              : "text-red-300/70 hover:text-red-200"
                          }`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="space-y-1 md:space-y-1.5">
                      <label
                        className={`text-xs font-bold ml-1 block ${
                          isClassic ? "text-slate-700" : "text-slate-300"
                        }`}
                      >
                        E-mail
                      </label>
                      <div className="relative">
                        <Mail
                          className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                            isClassic ? "text-emerald-600" : "text-emerald-400/80"
                          }`}
                        />
                        <input
                          ref={emailInputRef}
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Seu e-mail de acesso"
                          required
                          className={`w-full pl-10 pr-4 py-2.5 md:py-3 border focus:border-emerald-500 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all font-medium select-text ${
                            isClassic
                              ? "bg-slate-50 border-slate-200 focus:bg-white text-slate-900 placeholder:text-slate-400"
                              : "bg-[#1c222b] border-white/10 text-white placeholder:text-slate-500"
                          }`}
                        />
                      </div>
                    </div>

                    <div className="space-y-1 md:space-y-1.5">
                      <label
                        className={`text-xs font-bold ml-1 block ${
                          isClassic ? "text-slate-700" : "text-slate-300"
                        }`}
                      >
                        Senha
                      </label>
                      <div className="relative">
                        <Lock
                          className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                            isClassic ? "text-emerald-600" : "text-emerald-400/80"
                          }`}
                        />
                        <input
                          ref={passwordInputRef}
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          required
                          className={`w-full pl-10 pr-11 py-2.5 md:py-3 border focus:border-emerald-500 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all font-medium select-text ${
                            isClassic
                              ? "bg-slate-50 border-slate-200 focus:bg-white text-slate-900 placeholder:text-slate-400"
                              : "bg-[#1c222b] border-white/10 text-white placeholder:text-slate-500"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          className={`absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer ${
                            isClassic
                              ? "text-slate-400 hover:text-slate-700"
                              : "text-slate-400 hover:text-white"
                          }`}
                          tabIndex={-1}
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5 pt-0.5 px-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="w-4 h-4 rounded accent-emerald-600 cursor-pointer"
                        />
                        <span
                          className={`text-xs font-semibold ${
                            isClassic ? "text-slate-600" : "text-slate-300"
                          }`}
                        >
                          Lembrar-me (manter conectado por 30 dias)
                        </span>
                      </label>

                      {/* Face ID quick-login enrollment only makes sense on Mobile */}
                      <label className="flex md:hidden items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={enrollBiometrics}
                          onChange={(e) => setEnrollBiometrics(e.target.checked)}
                          className="w-4 h-4 rounded accent-emerald-600 cursor-pointer"
                        />
                        <span
                          className={`text-xs font-semibold ${
                            isClassic ? "text-emerald-700" : "text-emerald-300/90"
                          }`}
                        >
                          Habilitar login rápido no cartão Face ID
                        </span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={isLoading}
                      className={`w-full py-3.5 md:py-4 rounded-2xl bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-all disabled:opacity-60 ${
                        isClassic
                          ? "shadow-lg shadow-emerald-600/25"
                          : "shadow-lg shadow-emerald-950/60"
                      }`}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Autenticando...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="md:hidden">
                            {authMethod === "faceid"
                              ? "Ativar Face ID e Entrar"
                              : "Acessar Painel"}
                          </span>
                          <span className="hidden md:inline">Acessar Painel</span>
                        </>
                      )}
                    </button>
                  </form>
                )}

                {sheetView === "settings" && (
                  /* =========================================================
                     VIEW C: DEVICE & ACCESS SETTINGS
                     ========================================================= */
                  <div className="space-y-4 animate-fade-in-up">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setSheetView("cards")}
                        className={`inline-flex items-center gap-1.5 text-xs md:text-sm font-bold py-1 pr-2 cursor-pointer ${
                          isClassic
                            ? "text-emerald-700 hover:text-emerald-600"
                            : "text-emerald-400 hover:text-emerald-300"
                        }`}
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Voltar</span>
                      </button>
                      <span
                        className={`text-xs font-bold ${
                          isClassic ? "text-slate-700" : "text-slate-300"
                        }`}
                      >
                        Configurações de Acesso
                      </span>
                    </div>

                    {/* Mobile Biometric Status Card (Hidden on PC) */}
                    <div
                      className={`md:hidden p-3.5 rounded-2xl border space-y-2 ${
                        isClassic
                          ? "bg-slate-50 border-slate-200"
                          : "bg-[#1c222b] border-white/10"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-9 h-9 rounded-xl border flex items-center justify-center ${
                              isClassic
                                ? "bg-emerald-100/80 border-emerald-200 text-emerald-700"
                                : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                            }`}
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </div>
                          <div>
                            <p
                              className={`text-xs font-bold ${
                                isClassic ? "text-slate-900" : "text-white"
                              }`}
                            >
                              Status do Face ID / Biometria
                            </p>
                            <p
                              className={`text-[11px] ${
                                isClassic ? "text-slate-500" : "text-slate-400"
                              }`}
                            >
                              {hasBiometricToken
                                ? `Vinculado a ${email || displayName}`
                                : "Ainda não vinculado neste dispositivo"}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            hasBiometricToken
                              ? isClassic
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                : "bg-emerald-500/20 text-emerald-300"
                              : isClassic
                                ? "bg-slate-200 text-slate-600"
                                : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {hasBiometricToken ? "Ativo" : "Inativo"}
                        </span>
                      </div>

                      {hasWebAuthnHardware && (
                        <p
                          className={`text-[11px] flex items-center gap-1.5 pt-1 ${
                            isClassic ? "text-emerald-700" : "text-emerald-300/80"
                          }`}
                        >
                          <Fingerprint className="w-3.5 h-3.5 shrink-0" />
                          <span>Sensor biométrico do dispositivo detectado (WebAuthn).</span>
                        </p>
                      )}
                    </div>

                    {/* Desktop Session Status Card (PC Only — No Face ID) */}
                    <div
                      className={`hidden md:block p-4 rounded-2xl border ${
                        isClassic
                          ? "bg-slate-50 border-slate-200"
                          : "bg-[#1c222b] border-white/10"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
                              isClassic
                                ? "bg-emerald-100/80 border-emerald-200 text-emerald-700"
                                : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                            }`}
                          >
                            <ShieldCheck className="w-5 h-5" />
                          </div>
                          <div>
                            <p
                              className={`text-xs font-bold ${
                                isClassic ? "text-slate-900" : "text-white"
                              }`}
                            >
                              Sessão neste Computador
                            </p>
                            <p
                              className={`text-[11px] ${
                                isClassic ? "text-slate-500" : "text-slate-400"
                              }`}
                            >
                              Segurança aprimorada habilitada
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Settings Actions */}
                    <div className="pt-2 space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSheetView("cards");
                          startIntroSequence();
                        }}
                        className={`w-full py-3 px-4 rounded-2xl border text-xs font-bold flex items-center gap-2 cursor-pointer transition-colors ${
                          isClassic
                            ? "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800"
                            : "bg-[#1c222b] hover:bg-[#242c37] border-white/10 text-white"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <RotateCcw
                            className={`w-4 h-4 ${
                              isClassic ? "text-emerald-600" : "text-emerald-400"
                            }`}
                          />
                          <span>Repetir animação de abertura</span>
                        </span>
                      </button>

                      {(hasBiometricToken || email) && (
                        <button
                          type="button"
                          onClick={handleUnlinkDevice}
                          className={`w-full py-3 px-4 rounded-2xl border text-xs font-bold flex items-center justify-between cursor-pointer transition-colors ${
                            isClassic
                              ? "bg-red-50 hover:bg-red-100 border-red-200 text-red-600"
                              : "bg-red-500/10 hover:bg-red-500/20 border-red-500/25 text-red-300"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <LogOut className="w-4 h-4" />
                            <span className="md:hidden">
                              Trocar de conta / Desvincular Face ID
                            </span>
                            <span className="hidden md:inline">
                              Trocar de conta / Esquecer acesso salvo
                            </span>
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Help Mini-Sheet Overlay when clicking Ajuda */}
              {helpModalOpen && (
                <div
                  className={`absolute inset-0 z-30 backdrop-blur-md rounded-tr-[42px] md:rounded-tr-none md:rounded-tl-[56px] p-6 md:p-10 lg:p-12 flex flex-col justify-between animate-fade-in ${
                    isClassic
                      ? "bg-white/95 text-slate-900"
                      : "bg-[#12171d]/95 text-white"
                  }`}
                >
                  <div className="w-full max-w-[420px] mx-auto flex-1 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-9 h-9 rounded-xl border flex items-center justify-center ${
                            isClassic
                              ? "bg-emerald-100/80 border-emerald-200 text-emerald-700"
                              : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                          }`}
                        >
                          <HelpCircle className="w-4 h-4" />
                        </div>
                        <div>
                          <h3
                            className={`text-sm font-bold ${
                              isClassic ? "text-slate-900" : "text-white"
                            }`}
                          >
                            Como funciona o Acesso
                          </h3>
                          <p
                            className={`text-[11px] ${
                              isClassic ? "text-slate-500" : "text-slate-400"
                            }`}
                          >
                            Soluções Financeiras
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setHelpModalOpen(false)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ${
                          isClassic
                            ? "bg-slate-100 hover:bg-slate-200 text-slate-600"
                            : "bg-white/5 hover:bg-white/10 text-slate-300"
                        }`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Mobile Help Copy */}
                    <div
                      className={`md:hidden my-auto py-3 space-y-2 text-xs leading-relaxed ${
                        isClassic ? "text-slate-600" : "text-slate-300"
                      }`}
                    >
                      <p
                        className={`font-semibold ${
                          isClassic ? "text-slate-900" : "text-white"
                        }`}
                      >
                        Usando o Face ID ou Senha:
                      </p>
                      <p>
                        No primeiro acesso, entre com seu e-mail e senha para vincular seu
                        aparelho. Nos próximos acessos, basta tocar no cartão{" "}
                        <strong
                          className={
                            isClassic ? "text-emerald-700" : "text-emerald-400"
                          }
                        >
                          Face ID
                        </strong>{" "}
                        para entrar instantaneamente, ou falar conosco pelo botão{" "}
                        <strong
                          className={
                            isClassic ? "text-emerald-700" : "text-emerald-400"
                          }
                        >
                          Ligar
                        </strong>
                        .
                      </p>
                    </div>

                    {/* Desktop Help Copy (PC Only — No Face ID) */}
                    <div
                      className={`hidden md:block my-auto py-4 space-y-2.5 text-sm leading-relaxed ${
                        isClassic ? "text-slate-600" : "text-slate-300"
                      }`}
                    >
                      <p
                        className={`font-semibold ${
                          isClassic ? "text-slate-900" : "text-white"
                        }`}
                      >
                        Acessando pelo Computador:
                      </p>
                      <p>
                        Clique no cartão{" "}
                        <strong
                          className={
                            isClassic ? "text-emerald-700" : "text-emerald-400"
                          }
                        >
                          Com Senha
                        </strong>{" "}
                        e informe seu e-mail e senha cadastrados para acessar o painel de
                        gestão. Caso precise de suporte ou recuperação de acesso, fale
                        conosco diretamente pelo botão{" "}
                        <strong
                          className={
                            isClassic ? "text-emerald-700" : "text-emerald-400"
                          }
                        >
                          Ligar
                        </strong>
                        .
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setHelpModalOpen(false);
                        setSheetView("credentials");
                      }}
                      className="w-full py-3 md:py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs md:text-sm font-bold transition-colors cursor-pointer shadow-sm"
                    >
                      Preencher Credenciais
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}