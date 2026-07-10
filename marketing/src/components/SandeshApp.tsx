import { useState, useRef, useEffect, useCallback } from "react";
import {
  motion,
  AnimatePresence,
  useAnimation,
  useReducedMotion,
} from "framer-motion";
import { PostboxSvg } from "./PostboxSvg";
const stampSrc = "/sam.svg";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MORPH_SPRING = { type: "spring" as const, stiffness: 240, damping: 30, mass: 0.9 };

const LETTER_COPY = {
  intro: "is a new weekly publication started by",
  rest: ", bringing together the latest AI breakthroughs, startup stories, research, and technology, alongside hand-picked AI tools from leading AI startups, and a curated spotlight on India's AI ecosystem directly  into your inbox",
};
const EnvelopeBack = () => (
  <svg
    width="100%"
    height="100%"
    viewBox="0 0 1200 680"
    className="absolute inset-0 pointer-events-none"
    preserveAspectRatio="none"
  >
    {/* Side flaps */}
    <path
      d="M 0,0 L 576,340 L 0,680 Z"
      fill="#5A79B0"
      opacity="0.8"
    />
    <path
      d="M 1200,0 L 624,340 L 1200,680 Z"
      fill="#5A79B0"
      opacity="0.8"
    />
    {/* Bottom flap */}
    <path
      d="M 0,680 L 600,326.4 L 1200,680 Z"
      fill="#4F6A9B"
      opacity="0.95"
    />
    {/* Top flap */}
    <path
      d="M 0,0 L 600,306 L 1200,0 Z"
      fill="#6A89C1"
      stroke="#15408F"
      strokeWidth="2"
    />
    {/* Seam outlines */}
    <path
      d="M 0,0 L 600,326.4 L 1200,0 M 0,680 L 600,326.4 L 1200,680"
      stroke="#15408F"
      strokeWidth="2"
      fill="none"
      opacity="0.45"
    />
  </svg>
);

const FinaleCard = ({
  startRect,
  slotRect,
  email,
  onDropped,
  onDone,
}: {
  startRect: DOMRect;
  slotRect: DOMRect;
  email: string;
  onDropped: () => void;
  onDone: () => void;
}) => {
  const controls = useAnimation();
  const [clipBottom, setClipBottom] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const s = (slotRect.width * 0.86) / startRect.width;
      const scaledH = startRect.height * s;

      const mouthY = slotRect.top + slotRect.height * 0.42;

      const startCx = startRect.left + startRect.width / 2;
      const startCy = startRect.top + startRect.height / 2;
      const slotCx = slotRect.left + slotRect.width / 2;

      const targetX = slotCx - startCx;
      const hoverY = mouthY - scaledH / 2 - 6 - startCy;
      const arcTopY = Math.min(-48, hoverY - 170);
      const finalY = hoverY + scaledH + 22;

      // Phase 1: Lift off (quick preparation)
      await controls.start({
        y: -26,
        scale: Math.max(s * 2.1, 0.16),
        boxShadow: "0 14px 32px rgba(21, 64, 143, 0.3)",
        transition: { duration: 0.3, ease: [0.32, 0.72, 0.3, 1] },
      });
      if (cancelled) return;

      // Set clip path trigger slightly before the card hits the slot mouth (around 56% through flight)
      const flightDuration = 1.1; // seconds
      const clipDelay = 620; // ms
      setTimeout(() => {
        if (!cancelled) {
          setClipBottom(Math.max(0, window.innerHeight - mouthY));
        }
      }, clipDelay);

      // Phase 2: Combined arc flight and acceleration drop
      await controls.start({
        x: targetX,
        y: [-26, arcTopY, finalY],
        scale: [Math.max(s * 2.1, 0.16), Math.max(s * 2.1, 0.16) * 0.8, s],
        rotate: [0, -8, -1.5, 0],
        boxShadow: [
          "0 14px 32px rgba(21, 64, 143, 0.3)",
          "0 8px 20px rgba(21, 64, 143, 0.28)",
          "0 0px 0px rgba(21, 64, 143, 0)"
        ],
        transition: {
          duration: flightDuration,
          ease: "easeInOut",
          y: {
            duration: flightDuration,
            times: [0, 0.38, 1],
            ease: ["easeOut", "easeIn"] // Accelerates continuously down into the slot
          },
          scale: {
            duration: flightDuration,
            times: [0, 0.45, 1],
            ease: "easeInOut"
          },
          rotate: {
            duration: flightDuration,
            times: [0, 0.38, 0.72, 1],
            ease: "easeInOut"
          },
          boxShadow: {
            duration: flightDuration,
            times: [0, 0.72, 1],
            ease: "easeInOut"
          }
        },
      });
      if (cancelled) return;

      onDropped();
      setTimeout(onDone, 350);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 pointer-events-none"
      style={
        clipBottom !== null
          ? { clipPath: `inset(0px 0px ${clipBottom}px 0px)` }
          : undefined
      }
    >      {/*this is the shape of  crad that goes into the postbig*/}
      <motion.div
        data-testid="finale-blank-card"
        className="absolute rounded-lg bg-[#6A89C1] border border-[#15408F]/20 overflow-hidden"
        style={{
          left: startRect.left,
          top: startRect.top,
          width: startRect.width,
          height: startRect.height,
          boxShadow: "0 30px 80px rgba(21, 64, 143, 0.35)",
        }}
        animate={controls}
      >
        {/* Front of the letter: Text content & stamp (fades out during flight) */}
        <motion.div
          className="absolute inset-0 p-6 sm:p-10 md:p-14 flex flex-col pointer-events-none"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.38, ease: "easeInOut" }}
        >
          <div className="absolute top-6 right-6 sm:top-10 sm:right-10 md:top-12 md:right-14">
            <img src={stampSrc} alt="" aria-hidden="true" className="w-[72px] sm:w-[104px] md:w-[132px] h-auto drop-shadow-[0_3px_8px_rgba(21,54,143,0.25)]" />
          </div>

          <p className="font-editorial text-[#15408F] text-lg sm:text-2xl md:text-[1.75rem] leading-[1.5] max-w-[62%] sm:max-w-[58%]">
            <span className="font-devanagari text-xl sm:text-3xl md:text-4xl mr-2">
              संदेश
            </span>
            {LETTER_COPY.intro} <a href="https://pipper.dev" className="underline decoration-[#15408F]/60 underline-offset-4" onClick={(e) => e.preventDefault()}>pipper.dev</a>{LETTER_COPY.rest}
          </p>

          <div className="mt-auto w-full sm:w-[64%] md:w-[52%]">
            <div className="w-full bg-transparent font-editorial text-2xl sm:text-3xl md:text-4xl text-[#15408F] pb-2 border-b-2 border-[#15408F]/45">
              {email}
            </div>
          </div>
        </motion.div>

        {/* Back of the letter: Envelope flaps (fades in during flight) */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.38, ease: "easeInOut" }}
        >
          <EnvelopeBack />
        </motion.div>
      </motion.div>
    </div>
  );
};

const MiniLetterContent = () => (
  <div className="flex h-full w-full gap-2.5 p-3.5 text-left overflow-hidden">
    <div className="flex-1 flex flex-col min-w-0">
      <p className="font-editorial text-[9px] leading-[1.45] text-[#15408F]/85 overflow-hidden">
        <span className="font-devanagari text-[12px] text-[#15408F] font-medium">
          संदेश
        </span>{" "}
        is a new weekly publication started by pipper.dev, bringing together
        the latest AI breakthroughs, startup stories, research…
      </p>
      <div className="mt-auto pt-1.5">
        <p className="font-editorial text-[9px] text-[#15408F]/60 border-b border-[#15408F]/45 pb-px w-[85%]">
          your@mail.com
        </p>
      </div>
    </div>
    <img src={stampSrc} alt="" className="w-8 h-auto shrink-0 self-start" />
  </div>
);

export default function SandeshApp() {
  const [phase, setPhase] = useState("idle");
  const [status, setStatus] = useState("idle");
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [contentVisible, setContentVisible] = useState(true);
  const [finale, setFinale] = useState<{ startRect: DOMRect; slotRect: DOMRect } | null>(null);
  const [cycle, setCycle] = useState(0);
  const [postboxBounce, setPostboxBounce] = useState(0);
  const [returning, setReturning] = useState(false);

  const letterRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closingRef = useRef(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    // Preload the stamp SVG asset to prevent first-time open lag
    const img = new Image();
    img.src = stampSrc;
    img.decode().catch(() => {});
  }, []);

  const layoutId = `sandesh-letter-${cycle}`;
  const isExpanded = phase === "expanded";

  const handleOpen = useCallback(() => {
    if (phase !== "idle" || closingRef.current) return;
    setReturning(false);
    setPhase("expanded");
    setStatus("idle");
    setErrorMsg("");
  }, [phase]);

  const handleClose = useCallback(() => {
    if (
      phase !== "expanded" ||
      status === "loading" ||
      status === "success" ||
      closingRef.current
    )
      return;
    closingRef.current = true;
    setReturning(true);
    setPhase("idle");
    setStatus("idle");
    setErrorMsg("");
    setTimeout(() => {
      setReturning(false);
      closingRef.current = false;
    }, 700);
  }, [phase, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  useEffect(() => {
    if (isExpanded) {
      const t = setTimeout(() => inputRef.current?.focus(), 520);
      return () => clearTimeout(t);
    }
  }, [isExpanded]);

  const resetAll = useCallback(() => {
    setPhase("idle");
    setStatus("idle");
    setEmail("");
    setErrorMsg("");
    setContentVisible(true);
    setFinale(null);
    setCycle((c) => c + 1);
  }, []);

  const runFinale = useCallback(() => {
    const cardEl = letterRef.current;
    const slotEl = slotRef.current;
    if (!cardEl || !slotEl) {
      resetAll();
      return;
    }
    const startRect = cardEl.getBoundingClientRect();
    const slotRect = slotEl.getBoundingClientRect();

    setFinale({ startRect, slotRect });
    setPhase("finale");
  }, [resetAll]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading" || status === "success") return;
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setStatus("error");
      setErrorMsg("Please write a valid email address on the letter.");
      return;
    }
    setStatus("loading");
    setErrorMsg("");

    try {
      const response = await fetch("/api/subscribe.json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: value }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Failed to subscribe. Please try again.");
      }

      setStatus("success");
      await sleep(900);
      runFinale();
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to subscribe. Please try again.");
    }
  };

  return (
    <div
      data-testid="sandesh-stage"
      className="relative min-h-screen w-full overflow-hidden bg-[#15408F] selection:bg-[#DCE7F8]/28"
    >
      {/* Font Preloader Hack to prevent mid-animation font swap layout stutters */}
      <div style={{ opacity: 0, position: "absolute", pointerEvents: "none", zIndex: -9999, top: 0, left: 0 }} aria-hidden="true">
        <span style={{ fontFamily: "var(--font-serif)" }}>preload</span>
        <span style={{ fontFamily: "var(--font-geist)" }}>preload</span>
        <span style={{ fontFamily: "var(--font-devanagari)" }}>preload</span>
        <span style={{ fontFamily: "var(--font-editorial)" }}>preload</span>
      </div>

      <div
        className="fixed inset-0 z-[1] pointer-events-none opacity-5 "
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")",
          willChange: "transform",
          transform: "translateZ(0)",
        }}
        aria-hidden="true"
      />

      <AnimatePresence>
        {phase === "idle" && (
          <motion.div
            key="wordmark"
            className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none select-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.45, delay: 0.12 } }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
          >
            <div className="relative -translate-y-[3vh]">
              <svg width="919" height="453" viewBox="0 0 919 453" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-[clamp(220px,55vw,600px)] h-auto">
                <path d="M251 23.166L286 58.166L251 93.166L216 58.166L251 23.166Z" fill="#D1E1FF"/>
                <path d="M241.244 389.534H237.06L163.002 299.159C135.388 265.268 128.275 250.206 128.275 238.072C128.275 228.867 134.551 224.683 149.614 224.683C157.563 224.683 175.555 225.938 185.596 227.194C188.525 213.386 188.943 193.303 188.943 179.496C188.943 167.362 188.525 159.831 188.107 153.136H111.539L97.3131 125.94V121.756H390.614L404.84 148.952V153.136H355.886L356.723 385.35H352.539L319.067 363.593L319.485 281.168C308.188 285.352 295.636 287.444 283.503 287.444C268.022 287.444 242.918 284.096 211.119 258.574C204.006 271.126 193.128 278.657 175.555 282.004L262.582 371.961L241.244 389.534ZM319.904 239.746L320.741 153.136H221.997C222.834 163.596 223.253 179.077 223.253 184.098C223.253 208.784 221.161 229.286 217.813 241.838C228.273 248.114 253.796 255.227 272.624 255.227C292.289 255.227 310.699 247.277 319.904 239.746ZM250.573 34.728L279.861 64.0162L250.573 92.4677L221.703 64.0162L250.573 34.728ZM546.557 422.17H542.792L504.299 354.807C496.767 356.899 488.399 358.154 477.939 358.154C420.2 358.154 365.807 305.435 365.807 248.951C365.807 205.437 400.953 193.303 453.672 193.303H485.052V153.136H345.305L331.08 125.94V121.756H560.783L575.009 148.952V153.136H519.361C519.361 176.567 519.78 203.345 519.78 221.336L514.759 224.683H455.764C420.2 224.683 397.187 238.49 397.187 266.942C397.187 306.69 426.476 329.284 455.764 329.284C465.806 329.284 478.358 327.61 486.726 322.59C480.031 309.201 475.429 297.904 475.429 289.954C475.429 280.749 481.287 276.565 490.073 276.565C508.901 276.565 541.537 294.975 541.537 314.64C541.537 320.498 537.353 335.142 523.127 345.602L568.314 408.362L546.557 422.17ZM326.798 7.53177L327.216 4.60296C348.973 0.837326 365.709 0.000504692 370.73 0.000504692C413.407 0.000504692 444.369 51.4641 488.72 126.777H466.126C425.541 57.7402 409.641 38.4936 386.211 38.4936C377.006 38.4936 359.015 40.5857 346.044 43.0961L326.798 7.53177ZM580.174 307.109C551.304 307.109 529.965 281.168 529.965 265.268C529.965 258.992 533.731 254.808 544.191 254.808C559.672 254.808 576.826 264.013 591.47 273.636C606.951 269.452 620.34 263.176 631.219 254.39C578.918 234.306 552.977 207.947 552.977 177.822C552.977 168.617 555.488 160.249 560.09 153.136H515.739L501.514 125.94V121.756H806.948L821.174 148.952V153.136H772.221L773.058 387.442H768.873L735.401 365.685L737.075 153.136H671.385C683.938 166.943 692.724 184.935 692.724 206.692C692.724 253.553 653.394 285.77 616.993 299.577L688.122 371.961L666.783 389.534H662.599L594.818 305.853C589.378 306.69 584.776 307.109 580.174 307.109ZM644.189 241.419C654.649 228.449 660.507 212.131 660.507 193.721C660.507 158.575 637.913 150.207 621.595 150.207C597.328 150.207 588.542 168.199 588.542 184.098C588.542 205.018 604.859 223.846 644.189 241.419Z" fill="#D1E1FF" fill-opacity="0.45"/>
              </svg>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="absolute bottom-0 left-4 sm:left-8 md:left-12 z-20 pointer-events-none translate-y-[6px]"
        animate={postboxBounce ? { y: [0, 6, -2, 0] } : {}}
        transition={{ duration: 0.46, times: [0, 0.4, 0.72, 1], ease: "easeOut" }}
        key={`postbox-${postboxBounce}`}
        style={{ willChange: "transform" }}
      >
        <PostboxSvg
          slotRef={slotRef}
          className="w-[110px] sm:w-[150px] md:w-[190px] lg:w-[215px]"
        />
      </motion.div>

      <AnimatePresence>
        {phase === "idle" && (
          <motion.button
            key={`mini-${cycle}`}
            layoutId={layoutId}
            data-testid="minimized-letter-open-button"
            aria-expanded={false}
            aria-label="Open the Sandesh letter to join the waitlist"
            onClick={handleOpen}
            className="absolute bottom-20 right-5 sm:right-8 z-20 w-[218px] h-[112px] sm:w-[240px] sm:h-[118px] bg-[#6A89C1] rounded-lg border border-[#15408F]/20 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DCE7F8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#15408F] shadow-[0_18px_40px_rgba(21,64,143,0.28)]"
            transition={MORPH_SPRING}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.34, delay: 0.1 } }}
            exit={{ opacity: 0, transition: { duration: 0.01 } }}
            whileHover={reducedMotion ? {} : { y: -3 }}
            whileTap={{ scale: 0.99 }}
            style={{ willChange: "transform" }}
          >
            <motion.div
              className="h-full w-full"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { duration: 0.28, delay: returning ? 0.38 : 0.18 },
              }}
            >
              <MiniLetterContent />
            </motion.div>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase !== "idle" && (
          <motion.div
            key="small-wordmark"
            data-testid="small-wordmark"
            className="absolute bottom-12 right-6 sm:right-10 z-10 pointer-events-none select-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.3, delay: 0.22 } }}
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
          >
            <span className="font-devanagari text-[#6A89C1] text-4xl sm:text-5xl leading-none">
              संदेश
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="fixed inset-0 z-30 flex items-center justify-center px-4 sm:px-8"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) handleClose();
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <motion.div
              layoutId={layoutId}
              ref={letterRef}
              data-testid="expanded-letter-card"
              className="relative w-[94vw] max-w-[1200px] h-[68vh] min-h-[440px] max-h-[680px] bg-[#6A89C1] rounded-lg border border-[#15408F]/20 shadow-[0_30px_80px_rgba(21,64,143,0.4)]"
              transition={MORPH_SPRING}
              style={{ willChange: "transform" }}
            >
              <AnimatePresence>
                {contentVisible && (
                  <motion.div
                    key="letter-content"
                    className="absolute inset-0 flex flex-col p-6 sm:p-10 md:p-14"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.24, delay: 0.28 },
                    }}
                    exit={{ opacity: 0, transition: { duration: 0.22 } }}
                    aria-busy={status === "loading"}
                  >
                    <div className="absolute top-6 right-6 sm:top-10 sm:right-10 md:top-12 md:right-14">
                      <img src={stampSrc} alt="" aria-hidden="true" className="w-[72px] sm:w-[104px] md:w-[132px] h-auto drop-shadow-[0_3px_8px_rgba(21,64,143,0.25)]" />
                    </div>

                    <p
                      data-testid="expanded-letter-body"
                      className="font-editorial text-[#15408F] text-lg sm:text-2xl md:text-[1.75rem] leading-[1.5] max-w-[62%] sm:max-w-[58%]"
                    >
                      <span className="font-devanagari text-xl sm:text-3xl md:text-4xl mr-2">
                        संदेश
                      </span>
                      {LETTER_COPY.intro}{" "}
                      <a
                        data-testid="pipper-dev-link"
                        href="https://pipper.dev"
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-[#15408F]/60 underline-offset-4 hover:decoration-[#15408F] transition-colors duration-150"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        pipper.dev
                      </a>
                      {LETTER_COPY.rest}
                    </p>

                    <form
                      onSubmit={handleSubmit}
                      className="mt-auto w-full sm:w-[64%] md:w-[52%]"
                    >
                      <input
                        ref={inputRef}
                        data-testid="waitlist-email-input"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="your@mail.com"
                        value={email}
                        disabled={status === "loading" || status === "success"}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (status === "error") {
                            setStatus("idle");
                            setErrorMsg("");
                          }
                        }}
                        className={`w-full bg-transparent font-editorial text-2xl sm:text-3xl md:text-4xl text-[#15408F] pb-2 border-b-2 outline-none transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed caret-[#15408F] placeholder:text-[#15408F]/50 ${
                          status === "loading"
                            ? "border-[#15408F] animate-underline-shimmer"
                            : "border-[#15408F]/45 focus:border-[#15408F]"
                        }`}
                      />
                      <div className="h-8 mt-2.5" aria-live="polite">
                        {status === "loading" && (
                          <p className="font-editorial italic text-[#15408F]/70 text-sm sm:text-base animate-pulse">
                            sealing your letter…
                          </p>
                        )}
                        {status === "success" && (
                          <p className="font-editorial text-[#15408F] text-sm sm:text-base">
                            Your संदेश is on its way — welcome aboard.
                          </p>
                        )}
                        {status === "error" && errorMsg && (
                          <p className="font-editorial text-[#15408F]/85 text-sm sm:text-base">
                            {errorMsg}
                          </p>
                        )}
                      </div>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "finale" && finale && (
        <FinaleCard
          startRect={finale.startRect}
          slotRect={finale.slotRect}
          email={email}
          onDropped={() => setPostboxBounce((b) => b + 1)}
          onDone={resetAll}
        />
      )}
    </div>
  );
}
