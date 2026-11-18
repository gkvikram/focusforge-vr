/**
 * Theme presets and the shared controller that drives the world morph.
 * Side-effect free apart from the controller singleton, so any system or HUD
 * handler can request a theme without importing rendering code.
 */

import type { DirectionalLight, ShaderMaterial } from '@iwsdk/core';

export type ThemeId = 'zen' | 'cyberpunk' | 'orbital';

export interface ThemeParams {
  readonly id: ThemeId;
  readonly label: string;
  /** Sky gradient, hex sRGB. */
  readonly top: number;
  readonly horizon: number;
  readonly bottom: number;
  /** Directional sun light. */
  readonly sunColor: number;
  readonly sunIntensity: number;
  readonly sunDiscOpacity: number;
  readonly sunDiscColor: number;
  /** Fog and image-based lighting. */
  readonly fogColor: number;
  readonly fogDensity: number;
  readonly envIntensity: number;
  /** Platform accents. */
  readonly deck: number;
  readonly rock: number;
  readonly stone: number;
  readonly inlayEmissive: number;
  readonly inlayIntensity: number;
  readonly accent: number;
  readonly accentAlt: number;
  /** Particles and drifting light motes. */
  readonly moteColor: number;
  readonly cloudOpacity: number;
  /** Feature amounts, 0..1. */
  readonly stars: number;
  readonly nebula: number;
  readonly earth: number;
  readonly grid: number;
  readonly sunGlow: number;
  readonly rain: number;
  readonly petals: number;
}

export const THEMES: readonly ThemeParams[] = [
  {
    id: 'zen',
    label: 'Zen Garden',
    top: 0x6a96e0,
    horizon: 0xffc78f,
    bottom: 0xfad7b9,
    sunColor: 0xffd29c,
    sunIntensity: 1.8,
    sunDiscOpacity: 1,
    sunDiscColor: 0xfff0c8,
    fogColor: 0xf7d9b5,
    fogDensity: 0.012,
    envIntensity: 1,
    deck: 0xefe4d2,
    rock: 0xc9a27e,
    stone: 0x8f8579,
    inlayEmissive: 0xf2b866,
    inlayIntensity: 0.35,
    accent: 0xffd08a,
    accentAlt: 0xffb7c9,
    moteColor: 0xffd08a,
    cloudOpacity: 1,
    stars: 0,
    nebula: 0,
    earth: 0,
    grid: 0,
    sunGlow: 1,
    rain: 0,
    petals: 1,
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk Rooftop',
    top: 0x0d0726,
    horizon: 0x8a1f8c,
    bottom: 0x12082b,
    sunColor: 0x7f6bff,
    sunIntensity: 0.7,
    sunDiscOpacity: 0,
    sunDiscColor: 0xff4fd8,
    fogColor: 0x1a0b33,
    fogDensity: 0.05,
    envIntensity: 0.45,
    deck: 0x1d1a30,
    rock: 0x241a40,
    stone: 0x4a3a66,
    inlayEmissive: 0x00e5ff,
    inlayIntensity: 1.8,
    accent: 0x00e5ff,
    accentAlt: 0xff2d95,
    moteColor: 0xff4fd8,
    cloudOpacity: 0.12,
    stars: 0.15,
    nebula: 0,
    earth: 0,
    grid: 1,
    sunGlow: 0.2,
    rain: 1,
    petals: 0,
  },
  {
    id: 'orbital',
    label: 'Orbital Station',
    top: 0x01020a,
    horizon: 0x1a1a4a,
    bottom: 0x02030c,
    sunColor: 0xe3edff,
    sunIntensity: 2.2,
    sunDiscOpacity: 0.85,
    sunDiscColor: 0xdfe9ff,
    fogColor: 0x03040e,
    fogDensity: 0.004,
    envIntensity: 0.4,
    deck: 0x2b3342,
    rock: 0x3a3f4d,
    stone: 0x7a8392,
    inlayEmissive: 0x7cc7ff,
    inlayIntensity: 1.2,
    accent: 0x7cc7ff,
    accentAlt: 0xc59bff,
    moteColor: 0x9ecbff,
    cloudOpacity: 0,
    stars: 1,
    nebula: 1,
    earth: 1,
    grid: 0,
    sunGlow: 0.35,
    rain: 0,
    petals: 0,
  },
];

/** Charge tiers: 0 = Zen Garden, 1 (>=50%) = Cyberpunk Rooftop, 2 (100%) = Orbital Station. */
export function themeIndexForCharge(charge: number): number {
  if (charge >= 0.999) return 2;
  if (charge >= 0.5) return 1;
  return 0;
}

export interface ThemeRequest {
  readonly index: number;
  /** Skip the expanding wave and snap to the theme (used for the first frame). */
  readonly instant: boolean;
}

type ThemeListener = (request: ThemeRequest) => void;

class WorldThemeController {
  /** Scene objects registered by SanctuarySystem so the morph can recolor them. */
  readonly bindings: {
    sun: DirectionalLight | null;
    sunDisc: ShaderMaterial | null;
    motes: ShaderMaterial | null;
  } = { sun: null, sunDisc: null, motes: null };

  private current = 0;
  private chargeTier = 0;
  private listeners = new Set<ThemeListener>();
  private pending: ThemeRequest | null = null;

  get index(): number {
    return this.current;
  }

  get theme(): ThemeParams {
    return THEMES[this.current];
  }

  /** The morph system subscribes once and also receives any request made earlier. */
  subscribe(listener: ThemeListener): () => void {
    this.listeners.add(listener);
    if (this.pending) {
      listener(this.pending);
      this.pending = null;
    }
    return () => this.listeners.delete(listener);
  }

  /** Called by the reward system whenever the displayed core charge changes. */
  setCharge(charge: number): void {
    const tier = themeIndexForCharge(charge);
    if (tier === this.chargeTier) return;
    this.chargeTier = tier;
    this.request(tier);
  }

  cycle(): ThemeParams {
    this.request((this.current + 1) % THEMES.length);
    return THEMES[this.current];
  }

  request(index: number, instant = false): void {
    if (index === this.current && !instant) return;
    this.current = index;
    const request: ThemeRequest = { index, instant };
    if (this.listeners.size === 0) {
      this.pending = request;
      return;
    }
    for (const listener of this.listeners) listener(request);
  }
}

export const worldTheme = new WorldThemeController();
