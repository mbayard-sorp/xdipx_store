import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ProductAd.tsx — xdipx 15-second product ad (TransitionSeries rebuild)
 *
 * Output : 1080×1920 (vertical / social-first)
 * Duration: 450 frames @ 30fps = 15 seconds
 *
 * Scene 1 (frames   0–60 ):  Product Hero — hard cut, Ken Burns, VO starts
 * Scene 2 (frames  60–300):  Product Gallery — subtitles, reactions, hearts
 * Scene 3 (frames 300–450):  End Card — logo, tagline, CTA, progress bar
 *
 * Frame 0: exported as JPEG thumbnail (no animation, fully composed)
 *
 * TransitionSeries timing:
 *   SCENE1_DUR(75) + SCENE2_DUR(255) + SCENE3_DUR(150) − 2×TRANSITION(15) = 450 ✓
 */
import { AbsoluteFill, Audio, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, } from 'remotion';
import { TransitionSeries, springTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { z } from 'zod';
// ─── Brand tokens ─────────────────────────────────────────────────────────────
const BG = '#0D0D0D';
const WHITE = '#FFFFFF';
const ORANGE = '#FF8C00';
const RED_ORANGE = '#FF4500';
const PURPLE = '#7C8F78';
const GRADIENT = `linear-gradient(90deg, ${RED_ORANGE}, ${ORANGE})`;
const FONT = '"Plus Jakarta Sans", "Outfit", system-ui, -apple-system, sans-serif';
// ─── Schema ───────────────────────────────────────────────────────────────────
export const productAdSchema = z.object({
    productId: z.string(),
    productName: z.string(),
    brand: z.string().optional(),
    dealPrice: z.number().optional(),
    msrp: z.number().optional(),
    imageUrls: z.array(z.string()).min(1),
    voAudioFile: z.string(),
    /** Optional background music track (filename in remotion/public/). */
    musicAudioFile: z.string().optional(),
    narratorScript: z.string(),
    reactionText: z.array(z.string()).length(2),
    endTagline: z.string(),
    ctaWord: z.string(),
    logoUrl: z.string(),
    /** Pipeline compat — composition is internally fixed at 450 frames. */
    totalDurationInFrames: z.number().int().min(240).max(1800).optional(),
});
// ─── Scene timing ─────────────────────────────────────────────────────────────
const TRANSITION_DUR = 15; // frames per wipe/fade transition
const SCENE1_DUR = 75; // effective display: 60 frames (transition eats 15)
const SCENE2_DUR = 255; // effective display: 240 frames (2 transitions × 15)
const SCENE3_DUR = 150; // effective display: 150 frames (last scene, no exit)
// Total rendered = 75 + 255 + 150 − 2×15 = 450 ✓
// Approximate global frame offsets (for audio volume callbacks)
const SCENE2_GLOBAL_START = 60; // after scene1 effective
const SCENE3_GLOBAL_START = 300; // after scene1 + scene2 effective
// ─── Film grain overlay ───────────────────────────────────────────────────────
function FilmGrain() {
    const frame = useCurrentFrame();
    const seed = frame % 30;
    return (_jsx("div", { style: {
            position: 'absolute',
            inset: 0,
            opacity: 0.04,
            pointerEvents: 'none',
            zIndex: 1000,
            overflow: 'hidden',
        }, children: _jsxs("svg", { style: { width: '100%', height: '100%', display: 'block' }, xmlns: "http://www.w3.org/2000/svg", children: [_jsx("defs", { children: _jsxs("filter", { id: `g${seed}`, children: [_jsx("feTurbulence", { type: "fractalNoise", baseFrequency: "0.9", numOctaves: "4", seed: seed }), _jsx("feColorMatrix", { type: "saturate", values: "0" })] }) }), _jsx("rect", { width: "100%", height: "100%", filter: `url(#g${seed})` })] }) }));
}
// ─── Heartbeat logo ───────────────────────────────────────────────────────────
function HeartbeatLogo({ logoUrl, width = 160, opacity = 1, }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Pulse fires at the start of each 90-frame cycle, oscillates naturally back
    const cycleFrame = frame % 90;
    const pulse = spring({
        frame: cycleFrame,
        fps,
        config: { damping: 12, stiffness: 280 },
    });
    const logoScale = interpolate(pulse, [0, 1], [1.0, 1.06], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    return (_jsx("div", { style: { transform: `scale(${logoScale})`, opacity }, children: _jsx(Img, { src: logoUrl, style: { width, height: 'auto', filter: 'brightness(0) invert(1)' } }) }));
}
// ─── Scene 1: Product Hero ────────────────────────────────────────────────────
function ProductHero({ imageUrl, productName, logoUrl, }) {
    const frame = useCurrentFrame();
    // Slow Ken Burns zoom: 1.0 → 1.08 over the scene
    const kbScale = interpolate(frame, [0, SCENE1_DUR], [1.0, 1.08], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    // Shimmer: sweep gradient background-position on a 60-frame loop
    const shimmerPct = ((frame * 100) / 60) % 200;
    return (_jsxs(AbsoluteFill, { style: { background: BG, overflow: 'hidden' }, children: [_jsx(AbsoluteFill, { children: _jsx(Img, { src: imageUrl, style: {
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        transform: `scale(${kbScale})`,
                        transformOrigin: 'center center',
                    } }) }), _jsx("div", { style: {
                    position: 'absolute',
                    inset: 0,
                    background: `linear-gradient(to bottom, transparent 60%, ${BG} 100%)`,
                } }), _jsxs("div", { style: {
                    position: 'absolute',
                    top: 80,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 16,
                }, children: [_jsx(HeartbeatLogo, { logoUrl: logoUrl, width: 180, opacity: 1 }), _jsx("div", { style: {
                            fontFamily: FONT,
                            fontSize: 28,
                            fontWeight: 700,
                            color: WHITE,
                            letterSpacing: 4,
                        }, children: "xdipx.com" })] }), _jsx("div", { style: {
                    position: 'absolute',
                    bottom: 100,
                    left: 48,
                    right: 48,
                }, children: _jsx("div", { style: {
                        fontFamily: FONT,
                        fontSize: 52,
                        fontWeight: 800,
                        letterSpacing: -1,
                        lineHeight: 1.15,
                        background: `linear-gradient(90deg, ${RED_ORANGE}, ${ORANGE}, ${RED_ORANGE})`,
                        backgroundSize: '200% auto',
                        backgroundPosition: `${shimmerPct}% center`,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }, children: productName }) }), _jsx(FilmGrain, {})] }));
}
// ─── Gallery sub-scene (Ken Burns zoom or pan) ────────────────────────────────
function GallerySubScene({ imageUrl, index, duration, }) {
    const frame = useCurrentFrame();
    const isZoom = index % 2 === 0;
    const kbScale = isZoom
        ? interpolate(frame, [0, duration], [1.0, 1.07], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
        })
        : 1.0;
    const panX = !isZoom
        ? interpolate(frame, [0, duration], [0, index % 4 === 1 ? -40 : 40], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
        })
        : 0;
    return (_jsxs(AbsoluteFill, { style: { background: BG, overflow: 'hidden' }, children: [_jsx(Img, { src: imageUrl, style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: `scale(${kbScale}) translateX(${panX}px)`,
                    transformOrigin: 'center center',
                } }), _jsx("div", { style: {
                    position: 'absolute',
                    inset: 0,
                    background: `linear-gradient(to bottom, transparent 55%, rgba(13,13,13,0.85) 100%)`,
                } })] }));
}
// ─── Word-by-word narrator subtitle ──────────────────────────────────────────
function NarratorSubtitle({ script, totalFrames, }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const words = script.split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return null;
    const framesPerWord = totalFrames / words.length;
    const currentIdx = Math.min(Math.floor(frame / framesPerWord), words.length - 1);
    // Sliding window: show up to 6 words centred around current
    const startIdx = Math.max(0, currentIdx - 2);
    const endIdx = Math.min(words.length - 1, startIdx + 5);
    const visible = words.slice(startIdx, endIdx + 1);
    const localCur = currentIdx - startIdx;
    return (_jsx("div", { style: {
            position: 'absolute',
            bottom: '30%',
            left: '10%',
            right: '10%',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '8px 12px',
            alignItems: 'center',
        }, children: visible.map((word, i) => {
            const isCurrent = i === localCur;
            // Brief scale pop on the current word
            const wordStartFrame = Math.floor((startIdx + i) * framesPerWord);
            const popFrame = Math.max(0, frame - wordStartFrame);
            const pop = isCurrent
                ? spring({ frame: popFrame % Math.max(1, Math.ceil(framesPerWord)), fps, config: { damping: 80, stiffness: 600 } })
                : 0;
            const wordScale = isCurrent
                ? interpolate(pop, [0, 1], [1.0, 1.05], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
                : 1.0;
            return (_jsx("div", { style: {
                    fontFamily: FONT,
                    fontSize: 38,
                    fontWeight: 700,
                    color: WHITE,
                    textShadow: '0 2px 12px rgba(0,0,0,0.8)',
                    transform: `scale(${wordScale})`,
                    opacity: isCurrent ? 1 : 0.6,
                    borderBottom: isCurrent ? `3px solid ${ORANGE}` : '3px solid transparent',
                    paddingBottom: 2,
                    letterSpacing: -0.5,
                }, children: word }, startIdx + i));
        }) }));
}
// ─── Reaction bubble ──────────────────────────────────────────────────────────
function ReactionBubble({ text, delay, align, top, }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const appear = spring({
        frame: frame - delay,
        fps,
        config: { damping: 110, stiffness: 420 },
    });
    const opacity = interpolate(appear, [0, 0.5, 1], [0, 1, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const scaleVal = interpolate(appear, [0, 0.6, 1], [0.5, 1.06, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const translateY = interpolate(appear, [0, 1], [24, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return (_jsx("div", { style: {
            position: 'absolute',
            top,
            ...(align === 'left' ? { left: '8%' } : { right: '8%' }),
            opacity,
            transform: `scale(${scaleVal}) translateY(${translateY}px)`,
            zIndex: 10,
        }, children: _jsx("div", { style: {
                background: PURPLE,
                borderRadius: 100,
                padding: '14px 28px',
                boxShadow: '0 4px 28px rgba(123,47,190,0.4)',
                maxWidth: 420,
            }, children: _jsx("div", { style: {
                    fontFamily: FONT,
                    fontSize: 32,
                    fontWeight: 600,
                    color: WHITE,
                    lineHeight: 1.3,
                }, children: text }) }) }));
}
// ─── Floating hearts ──────────────────────────────────────────────────────────
function FloatingHeart({ startFrame, xDrift, }) {
    const frame = useCurrentFrame();
    const localFrame = frame - startFrame;
    if (localFrame < 0 || localFrame > 60)
        return null;
    const opacity = interpolate(localFrame, [0, 10, 50, 60], [0, 1, 1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    const translateY = interpolate(localFrame, [0, 60], [0, -180], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    const translateX = interpolate(localFrame, [0, 60], [0, xDrift], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    return (_jsx("div", { style: {
            position: 'absolute',
            right: 48,
            bottom: '40%',
            opacity,
            transform: `translateY(${translateY}px) translateX(${translateX}px)`,
            fontSize: 40,
            color: PURPLE,
            pointerEvents: 'none',
            zIndex: 20,
        }, children: "\u2665" }));
}
// ─── Scene 2: Product gallery with overlays ───────────────────────────────────
function ProductGallery({ imageUrls, narratorScript, reactionText, logoUrl, totalDur, }) {
    // Exclude first image (used in Scene 1); fallback to it if only one image
    const galleryImages = imageUrls.length > 1 ? imageUrls.slice(1) : [imageUrls[0]];
    const n = galleryImages.length;
    const innerTransDur = 12;
    const totalTransitions = n - 1;
    const perImageDur = Math.round((totalDur + totalTransitions * innerTransDur) / n);
    // Build TransitionSeries children for the gallery
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const galleryItems = [];
    for (let i = 0; i < n; i++) {
        if (i > 0) {
            galleryItems.push(_jsx(TransitionSeries.Transition, { presentation: slide({ direction: 'from-right' }), timing: springTiming({ config: { damping: 200 }, durationInFrames: innerTransDur }) }, `t${i}`));
        }
        galleryItems.push(_jsx(TransitionSeries.Sequence, { durationInFrames: perImageDur, children: _jsx(GallerySubScene, { imageUrl: galleryImages[i], index: i, duration: perImageDur }) }, `s${i}`));
    }
    // Reaction bubbles: appear at local frames 80 and 130
    // (corresponding roughly to global frames 140 and 190 — Scene 2 starts ~frame 60)
    const REACTION1_DELAY = 80;
    const REACTION2_DELAY = 130;
    // Floating hearts: staggered local frames 40, 100, 160
    // (corresponding roughly to global 100, 160, 220)
    const hearts = [
        { startFrame: 40, xDrift: -20 },
        { startFrame: 100, xDrift: -15 },
        { startFrame: 160, xDrift: -25 },
    ];
    return (_jsxs(AbsoluteFill, { children: [_jsx(TransitionSeries, { children: galleryItems }), _jsx("div", { style: {
                    position: 'absolute',
                    top: 56,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    zIndex: 5,
                }, children: _jsx(HeartbeatLogo, { logoUrl: logoUrl, width: 120, opacity: 0.8 }) }), _jsx(NarratorSubtitle, { script: narratorScript, totalFrames: totalDur }), _jsx(ReactionBubble, { text: reactionText[0] ?? '...adding to cart', delay: REACTION1_DELAY, align: "left", top: "35%" }), _jsx(ReactionBubble, { text: reactionText[1] ?? 'my therapist said treat yourself so', delay: REACTION2_DELAY, align: "right", top: "45%" }), hearts.map((h, i) => (_jsx(FloatingHeart, { startFrame: h.startFrame, xDrift: h.xDrift }, i))), _jsx(FilmGrain, {})] }));
}
// ─── Scene 3: End card ────────────────────────────────────────────────────────
function EndCard({ imageUrl, endTagline, ctaWord, dealPrice, logoUrl, }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Product image entrance: scale 0.85 → 1.0
    const imgSpring = spring({ frame, fps, config: { damping: 200, stiffness: 200 } });
    const imgScale = interpolate(imgSpring, [0, 1], [0.85, 1.0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    // End tagline — local frame 19 (≈ global 320)
    const taglineSpring = spring({ frame: frame - 19, fps, config: { damping: 200 } });
    const taglineOpacity = interpolate(taglineSpring, [0, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const taglineY = interpolate(taglineSpring, [0, 1], [24, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    // CTA word — local frame 44 (≈ global 345), with overshoot slam
    const ctaSpring = spring({ frame: frame - 44, fps, config: { damping: 80, stiffness: 640 } });
    const ctaScale = interpolate(ctaSpring, [0, 1], [1.4, 1.0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const ctaOpacity = interpolate(ctaSpring, [0, 0.2, 1], [0, 1, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    // Deal price — local frame 59 (≈ global 360)
    const priceOpacity = interpolate(frame, [59, 75], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    // Progress bar — drains left to right over 150 frames
    const progressPct = interpolate(frame, [0, 150], [100, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return (_jsxs(AbsoluteFill, { style: { background: BG }, children: [_jsx("div", { style: {
                    position: 'absolute',
                    top: -200,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 800,
                    height: 800,
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${RED_ORANGE}22 0%, transparent 70%)`,
                    pointerEvents: 'none',
                } }), _jsxs(AbsoluteFill, { style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 60px',
                    gap: 32,
                    paddingBottom: 80,
                }, children: [_jsx(HeartbeatLogo, { logoUrl: logoUrl, width: 160, opacity: 1 }), _jsx("div", { style: {
                            width: '80%',
                            aspectRatio: '1 / 1',
                            borderRadius: 24,
                            overflow: 'hidden',
                            boxShadow: `0 8px 40px rgba(255,69,0,0.3)`,
                            transform: `scale(${imgScale})`,
                        }, children: _jsx(Img, { src: imageUrl, style: { width: '100%', height: '100%', objectFit: 'cover' } }) }), _jsx("div", { style: {
                            opacity: taglineOpacity,
                            transform: `translateY(${taglineY}px)`,
                            textAlign: 'center',
                        }, children: _jsx("div", { style: {
                                fontFamily: FONT,
                                fontSize: 56,
                                fontWeight: 800,
                                letterSpacing: -0.5,
                                background: GRADIENT,
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                                lineHeight: 1.2,
                            }, children: endTagline }) }), _jsx("div", { style: {
                            opacity: ctaOpacity,
                            transform: `scale(${ctaScale})`,
                        }, children: _jsx("div", { style: {
                                fontFamily: FONT,
                                fontSize: 72,
                                fontWeight: 900,
                                letterSpacing: -1,
                                color: WHITE,
                            }, children: ctaWord }) }), dealPrice != null && (_jsx("div", { style: { opacity: priceOpacity }, children: _jsxs("div", { style: {
                                fontFamily: FONT,
                                fontSize: 36,
                                fontWeight: 600,
                                color: ORANGE,
                            }, children: ["Today only: $", dealPrice] }) }))] }), _jsx("div", { style: {
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: `${progressPct}%`,
                    height: 3,
                    background: GRADIENT,
                } }), _jsx(FilmGrain, {})] }));
}
// ─── Main composition ─────────────────────────────────────────────────────────
export function ProductAd({ productId: _productId, productName, brand: _brand, dealPrice, msrp: _msrp, imageUrls, voAudioFile, musicAudioFile, narratorScript, reactionText, endTagline, ctaWord, logoUrl, totalDurationInFrames: _totalDurationInFrames, }) {
    const img0 = imageUrls[0];
    return (_jsxs(AbsoluteFill, { style: { background: BG }, children: [voAudioFile ? (_jsx(Audio, { src: staticFile(voAudioFile), startFrom: 0, volume: 1 })) : null, musicAudioFile ? (_jsx(Audio, { src: staticFile(musicAudioFile), startFrom: 0, volume: (frame) => {
                    if (frame < SCENE2_GLOBAL_START)
                        return 1.0; // scene 1: 100%
                    if (frame < SCENE3_GLOBAL_START)
                        return 0.12; // scene 2: ducked
                    return 0.6; // scene 3: swell
                } })) : null, _jsxs(TransitionSeries, { children: [_jsx(TransitionSeries.Sequence, { durationInFrames: SCENE1_DUR, children: _jsx(ProductHero, { imageUrl: img0, productName: productName, logoUrl: logoUrl }) }), _jsx(TransitionSeries.Transition, { presentation: wipe(), timing: springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION_DUR }) }), _jsx(TransitionSeries.Sequence, { durationInFrames: SCENE2_DUR, children: _jsx(ProductGallery, { imageUrls: imageUrls, narratorScript: narratorScript, reactionText: reactionText, logoUrl: logoUrl, totalDur: SCENE2_DUR }) }), _jsx(TransitionSeries.Transition, { presentation: fade(), timing: springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION_DUR }) }), _jsx(TransitionSeries.Sequence, { durationInFrames: SCENE3_DUR, children: _jsx(EndCard, { imageUrl: img0, endTagline: endTagline, ctaWord: ctaWord, logoUrl: logoUrl, ...(dealPrice != null ? { dealPrice } : {}) }) })] })] }));
}
