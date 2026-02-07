'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

interface ParticleTextWaveProps {
  text: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  gradientColors?: string[];

  /** Optional second gradient for the latter word(s). Applied after the last space in the text. */
  secondaryGradientColors?: string[];
  glowColor?: string;
  particleSize?: number;
  particleGap?: number;
  waveRadius?: number;
  waveAmplitude?: number;
  waveSpeed?: number;
  returnSpeed?: number;
  damping?: number;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  color: string;
  phase: number;
  staggerDelay: number;
  arrived: boolean;
}

function interpolateColor(colors: string[], t: number): string {
  if (colors.length === 1) {
    return colors[0];
  }

  const segments = colors.length - 1;
  const segment = Math.min(Math.floor(t * segments), segments - 1);
  const segmentT = t * segments - segment;
  const color1 = colors[segment];
  const color2 = colors[segment + 1];
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);
  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * segmentT);
  const g = Math.round(g1 + (g2 - g1) * segmentT);
  const b = Math.round(b1 + (b2 - b1) * segmentT);

  return `rgb(${r}, ${g}, ${b})`;
}

export default function ParticleTextWave({
  text,
  fontSize = 72,
  fontFamily = 'Orbitron, system-ui, sans-serif',
  fontWeight = '800',
  gradientColors = ['#D13F00', '#FF6B00', '#FFB42C'],
  secondaryGradientColors,
  glowColor = 'rgba(255, 120, 40, 0.2)',
  particleSize = 2,
  particleGap = 4,
  waveRadius = 150,
  waveAmplitude = 12,
  waveSpeed = 0.15,
  returnSpeed = 0.06,
  damping = 0.88,
  className = '',
}: ParticleTextWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000, lastX: -1000, lastY: -1000 });
  const animationRef = useRef<number>(0);
  const baseDimsRef = useRef({ width: 0, height: 0 });
  const timeRef = useRef(0);
  const waveOriginRef = useRef({ x: -1000, y: -1000, active: false, startTime: 0 });

  // Reduced motion detection
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);

    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);

    return () => mq.removeEventListener('change', handler);
  }, []);

  // Compute responsive font size based on container width
  const [responsiveFontSize, setResponsiveFontSize] = useState(fontSize);

  useEffect(() => {
    function updateSize() {
      const container = containerRef.current;

      if (!container) {
        return;
      }

      const containerWidth = container.clientWidth;

      /*
       * Scale font so the text fits comfortably within the container
       * Rough estimate: 6 chars of Orbitron at fontSize X takes about X * 4.2 pixels
       */
      const estimatedTextWidth = fontSize * text.length * 0.7;

      if (estimatedTextWidth > containerWidth * 0.95) {
        const scale = (containerWidth * 0.9) / estimatedTextWidth;
        setResponsiveFontSize(Math.floor(fontSize * scale));
      } else {
        setResponsiveFontSize(fontSize);
      }
    }
    updateSize();
    window.addEventListener('resize', updateSize);

    return () => window.removeEventListener('resize', updateSize);
  }, [fontSize, text]);

  // Scale wave parameters proportionally to font size ratio
  const sizeRatio = responsiveFontSize / fontSize;
  const scaledWaveRadius = waveRadius * sizeRatio;
  const scaledWaveAmplitude = waveAmplitude * sizeRatio;
  const scaledParticleSize = Math.max(1, particleSize * sizeRatio);
  const scaledParticleGap = Math.max(2, Math.round(particleGap * sizeRatio));

  const generateParticles = useCallback(() => {
    const particles: Particle[] = [];
    const offscreen = document.createElement('canvas');
    const offCtx = offscreen.getContext('2d');

    if (!offCtx) {
      return particles;
    }

    offCtx.font = `${fontWeight} ${responsiveFontSize}px ${fontFamily}`;

    const metrics = offCtx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = responsiveFontSize * 1.2;
    const textPadding = responsiveFontSize * 0.35;

    // Extra margin around the text so scattered particles aren't clipped at canvas edges
    const scatterMargin = responsiveFontSize * 1.6;
    offscreen.width = Math.ceil(textWidth) + textPadding * 2 + scatterMargin * 2;
    offscreen.height = Math.ceil(textHeight) + textPadding * 2 + scatterMargin * 2;
    baseDimsRef.current = { width: offscreen.width, height: offscreen.height };

    offCtx.font = `${fontWeight} ${responsiveFontSize}px ${fontFamily}`;
    offCtx.fillStyle = 'white';
    offCtx.textBaseline = 'top';
    offCtx.fillText(text, textPadding + scatterMargin, textPadding + scatterMargin);

    const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
    const data = imageData.data;

    const cx = offscreen.width / 2;
    const cy = offscreen.height / 2;
    const scatterScale = 150 * sizeRatio;

    // Find the pixel boundary where secondary gradient starts (after last space)
    const textOffsetX = textPadding + scatterMargin;
    let secondaryStartX = offscreen.width;

    if (secondaryGradientColors) {
      const lastSpaceIdx = text.lastIndexOf(' ');

      if (lastSpaceIdx >= 0) {
        const beforeSpace = text.slice(0, lastSpaceIdx + 1);
        secondaryStartX = offCtx.measureText(beforeSpace).width + textOffsetX;
      }
    }

    for (let y = 0; y < offscreen.height; y += scaledParticleGap) {
      for (let x = 0; x < offscreen.width; x += scaledParticleGap) {
        const index = (y * offscreen.width + x) * 4;
        const alpha = data[index + 3];

        if (alpha > 128) {
          const isSecondary = secondaryGradientColors && x >= secondaryStartX;
          const colors = isSecondary ? secondaryGradientColors : gradientColors;

          // Normalize t within each word's range for a clean gradient
          const t = isSecondary
            ? (x - secondaryStartX) / Math.max(1, offscreen.width - secondaryStartX)
            : x / Math.max(1, secondaryStartX);
          const color = interpolateColor(colors, Math.min(1, Math.max(0, t)));

          let startX = x;
          let startY = y;
          let staggerDelay = 0;

          if (!reducedMotion) {
            /*
             * Scatter from random positions in a soft cloud around center
             * NOT outward from text position (which would reveal the rectangle)
             */
            const randomAngle = Math.random() * Math.PI * 2;
            const randomDist = (0.3 + Math.random() * 0.7) * scatterScale;
            startX = cx + Math.cos(randomAngle) * randomDist * 1.8;
            startY = cy + Math.sin(randomAngle) * randomDist * 0.8;
            staggerDelay = t * 0.6;
          }

          particles.push({
            x: startX,
            y: startY,
            originX: x,
            originY: y,
            vx: 0,
            vy: 0,
            size: scaledParticleSize + Math.random() * 0.5 * sizeRatio,
            opacity: 0.7 + (alpha / 255) * 0.3,
            color,
            phase: Math.random() * Math.PI * 2,
            staggerDelay,
            arrived: false,
          });
        }
      }
    }

    return particles;
  }, [
    text,
    responsiveFontSize,
    fontFamily,
    fontWeight,
    scaledParticleGap,
    scaledParticleSize,
    gradientColors,
    secondaryGradientColors,
    sizeRatio,
    reducedMotion,
  ]);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return;
    }

    const particles = particlesRef.current;
    const mouse = mouseRef.current;
    timeRef.current += 0.016;

    const mouseMoved = Math.abs(mouse.x - mouse.lastX) > 2 || Math.abs(mouse.y - mouse.lastY) > 2;

    if (mouseMoved && mouse.x > 0 && mouse.y > 0) {
      waveOriginRef.current = {
        x: mouse.x,
        y: mouse.y,
        active: true,
        startTime: timeRef.current,
      };
    }

    mouse.lastX = mouse.x;
    mouse.lastY = mouse.y;

    const { width: baseW, height: baseH } = baseDimsRef.current;
    ctx.clearRect(0, 0, baseW, baseH);

    const wave = waveOriginRef.current;

    particles.forEach((particle) => {
      // Skip particles still waiting to enter
      if (timeRef.current < particle.staggerDelay) {
        return;
      }

      const introTime = timeRef.current - particle.staggerDelay;
      const introPhase = introTime < 2.0;
      const introProgress = Math.min(introTime / 1.5, 1);
      const introSpring = introPhase ? returnSpeed * (0.5 + introProgress * 1.5) : returnSpeed;
      const introDamping = introPhase ? 0.96 : damping;

      // Mark arrived when close to home
      if (!particle.arrived) {
        const distToHome = Math.sqrt((particle.originX - particle.x) ** 2 + (particle.originY - particle.y) ** 2);

        if (distToHome < 2) {
          particle.arrived = true;
        }
      }

      // Wave interaction only after arrived
      if (particle.arrived && wave.active) {
        const dx = particle.originX - wave.x;
        const dy = particle.originY - wave.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const timeSinceWave = timeRef.current - wave.startTime;
        const wavePosition = timeSinceWave * waveSpeed * 400 * sizeRatio;
        const waveWidth = 60 * sizeRatio;

        const distFromWave = Math.abs(distance - wavePosition);

        if (distFromWave < waveWidth && distance < scaledWaveRadius * 3) {
          const waveIntensity = 1 - distFromWave / waveWidth;
          const fadeOut = Math.max(0, 1 - timeSinceWave * 0.8);

          const angle = Math.atan2(dy, dx);
          const pushStrength = scaledWaveAmplitude * waveIntensity * fadeOut;

          particle.vx += Math.cos(angle) * pushStrength * 0.15;
          particle.vy += Math.sin(angle) * pushStrength * 0.15;
        }

        if (timeSinceWave > 2) {
          waveOriginRef.current.active = false;
        }
      }

      // Ambient wave only after arrived
      if (particle.arrived) {
        const ambientWave = Math.sin(timeRef.current * 2 + particle.originX * 0.02 + particle.phase) * 0.15;
        particle.vy += ambientWave * 0.06 * sizeRatio;
      }

      // Use intro spring/damping during coalescing, normal after
      particle.vx += (particle.originX - particle.x) * introSpring;
      particle.vy += (particle.originY - particle.y) * introSpring;
      particle.vx *= introDamping;
      particle.vy *= introDamping;
      particle.x += particle.vx;
      particle.y += particle.vy;

      const displacement = Math.sqrt(
        Math.pow(particle.x - particle.originX, 2) + Math.pow(particle.y - particle.originY, 2),
      );

      // Fade in during first 0.4s of each particle's life
      const fadeIn = Math.min(1, introTime / 0.4);

      // Glow
      const glowSize = particle.size * 3;
      const gradient = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, glowSize);
      gradient.addColorStop(0, glowColor);
      gradient.addColorStop(1, 'rgba(255, 100, 0, 0)');
      ctx.globalAlpha = fadeIn;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, glowSize, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Main particle
      const brightnessBoost = Math.min(displacement / 30, 0.4);
      ctx.globalAlpha = Math.min(1, (particle.opacity + brightnessBoost) * fadeIn);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    animationRef.current = requestAnimationFrame(animate);
  }, [glowColor, scaledWaveRadius, scaledWaveAmplitude, waveSpeed, returnSpeed, damping, sizeRatio]);

  // Init: generate particles, set up DPR-aware canvas
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    let cancelled = false;

    const init = () => {
      if (cancelled) {
        return;
      }

      const particles = generateParticles();
      particlesRef.current = particles;

      const { width: baseW, height: baseH } = baseDimsRef.current;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = baseW * dpr;
      canvas.height = baseH * dpr;
      canvas.style.width = `${baseW}px`;
      canvas.style.height = `${baseH}px`;

      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      animate();
    };

    if (document.fonts?.ready) {
      document.fonts.ready.then(init);
    } else {
      setTimeout(init, 100);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationRef.current);
    };
  }, [generateParticles, animate]);

  // Mouse events
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const getCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const { width: baseW, height: baseH } = baseDimsRef.current;
      const scaleX = baseW / rect.width;
      const scaleY = baseH / rect.height;

      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    };

    const handleMouseMove = (e: MouseEvent) => {
      const { x, y } = getCoords(e.clientX, e.clientY);
      mouseRef.current.x = x;
      mouseRef.current.y = y;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const { x, y } = getCoords(touch.clientX, touch.clientY);
        mouseRef.current.x = x;
        mouseRef.current.y = y;
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const { x, y } = getCoords(touch.clientX, touch.clientY);
        mouseRef.current.x = x;
        mouseRef.current.y = y;
      }
    };

    const handleLeave = () => {
      mouseRef.current.x = -1000;
      mouseRef.current.y = -1000;
    };

    document.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleLeave);
    canvas.addEventListener('touchmove', handleTouchMove, { passive: true });
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
    canvas.addEventListener('touchend', handleLeave);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleLeave);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchend', handleLeave);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label={text}
      style={{ width: '100%', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} aria-hidden="true" style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
    </div>
  );
}
