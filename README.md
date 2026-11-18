# FocusForge VR

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![IWSDK](https://img.shields.io/badge/IWSDK-%40iwsdk%2Fcore-6f42c1.svg)](https://developers.meta.com/horizon/documentation/web/webxr-iwsdk-overview)
[![Framework: Vite](https://img.shields.io/badge/Framework-Vite-646cff.svg)](https://vite.dev/)

**A gamified spatial productivity and mixed-reality sanctuary built on Meta's
[Immersive Web SDK](https://developers.meta.com/horizon/documentation/web/webxr-iwsdk-overview)
(`@iwsdk/core`).**

Plan and focus on a floating zen sanctuary above the clouds. Move tasks across a
curved Kanban board, let the Pomodoro ring time your focus, and turn every finished
task into an Energy Orb that charges the world around you.

## Live Demo

**[https://focusforge-vr-b-6i.vercel.app/](https://focusforge-vr-b-6i.vercel.app/)**

Open it in the Meta Quest Browser for a real immersive session, on a desktop
browser for the built-in WebXR emulator, or on a phone for 360° touch and gyro
mode. See the [Controls Guide](#controls-guide).

## Key Features

### Single-Task Spatial Kanban (UIKitML)

- A curved 3D task board with **To-Do**, **Doing** and **Done** columns, authored
  as UIKitML panels.
- A work-in-progress limit of one: a To-Do task cannot start while another task is
  in Doing, which enforces single-task deep focus.
- A 3D **Pomodoro ring timer** that starts when a card moves to Doing and
  completes the task when it finishes.
- A **Demo 10s** button on the timer panel runs a 10-second session so judges can
  see the full loop without waiting 25 minutes.

### Mixed-Reality Passthrough and Opacity Control

- **Enter MR Passthrough** requests a WebXR `immersive-ar` session so the sanctuary
  sits on top of your real room, desk and laptop.
- A live **Passthrough / Opacity** slider (0%-100%) controls the environment's
  translucency, so you can blend the virtual world with your workspace.

### Procedural Spatial Audio (Web Audio API)

- Zero audio assets: **Rain**, **Lo-Fi** and **Synthwave** soundscapes are
  synthesized at runtime with the Web Audio API, along with the interaction sounds.
- A physical **Spatial Audio console** in the scene has a toggle switch per
  soundscape, a **MUTE** button and an **EXIT XR** button.
- **EXIT XR** only appears while a headset session is active, and ends the session
  so you can get back to the landing screen hands-free (pinch, poke or ray click).

### Havok Physics Reward Loop and World Morphs

- Clearing a task turns its card into a throwable **Energy Orb**.
- Throw the orb to shatter the orbiting **Stress Targets**; each hit charges the
  **Central Energy Core**.
- As the core charges, shader-wave morphs transform the whole world:

| Core charge | World                  |
| ----------- | ---------------------- |
| 0%          | Zen Garden             |
| 50%         | Cyberpunk Rooftop      |
| 100%        | Orbital Station        |

## Controls Guide

### Meta Quest (Meta Quest Browser)

1. Open the live demo in the Quest Browser.
2. Tap **Enter VR** for a fully virtual sanctuary, or **Enter MR Passthrough** to
   see your real room behind it.
3. Use hand tracking (pinch) or controllers (ray + trigger) to drag cards across
   the board, press **Start** or **Demo 10s** on the timer, flip the audio switches
   and throw Energy Orbs. Gaze-pinch also works.
4. Use the **Passthrough / Opacity** slider to adjust how much of your room shows
   through.
5. Press **EXIT XR** on the audio console, under MUTE, to leave the session.

### Desktop Browser (IWER WebXR emulator)

1. Open the live demo, or run it locally (see [Local Setup](#tech-stack-and-local-setup)).
2. Click **Enter VR** or **Enter MR Passthrough**. The Immersive Web Emulation
   Runtime (IWER) starts an emulated Meta Quest 3 session with on-screen controller
   panels.
3. Move the emulated headset and controllers with the overlay and use the trigger,
   grip and button controls to interact with the scene.

The emulator is injected into the build; see [XR emulation](#xr-emulation) for how
it is gated.

### Mobile Phones (360° Touch and Gyro Mode)

1. Open the live demo on your phone.
2. Tap **Enter 360° Touch & Gyro Mode** for a non-headset view of the same scene.
3. Drag to look around, tap cards and controls, and use **Gyro** to steer the view
   with your phone's motion sensors.
4. Use **Cycle Theme** to preview the three world themes and **Passthrough /
   Opacity** to adjust translucency. Tap **Exit** to return to the landing screen.

## Tech Stack and Local Setup

| Area           | Technology                                                           |
| -------------- | -------------------------------------------------------------------- |
| Build          | [Vite](https://vite.dev/) and TypeScript                              |
| XR framework   | `@iwsdk/core` (Immersive Web SDK, ECS)                                |
| 3D             | [Three.js](https://threejs.org/), imported through `@iwsdk/core`      |
| Spatial UI     | UIKitML panels (`public/ui/*.uikitml`)                                |
| Physics        | Havok Physics through the IWSDK physics components                    |
| Audio          | Web Audio API, fully procedural                                       |
| Desktop XR     | IWER (Immersive Web Emulation Runtime)                                |

```bash
npm install && npm run dev
```

Open [http://localhost:5173](http://localhost:5173), then pick a mode on the
landing screen.

Other scripts:

```bash
npm run dev:runtime   # plain Vite, no managed browser or MCP bridge
npm run typecheck     # tsc --noEmit
npm run build         # production build into dist/
npm run preview       # serve the production build
```

`npm run dev` is the IWSDK managed dev server. It serves the app like Vite and also
hosts the tooling bridge used by the scene editor. Use `npm run dev:runtime` for
bare Vite. Node 20.19+, 22.12+ or 24+ is required.

### Project structure

```
iwsdk.config.json            project authority: scene, assets, components, XR, emulator
src/
  index.ts                   World.create() and system registration
  landing.ts                 landing screen: Enter VR / MR / 360° buttons
  focus/                     Kanban, Pomodoro, audio console, rewards, layout
  world/                     world themes and shader-wave morph system
  audio/                     procedural Web Audio sound engine
  mobile/                    360° touch and gyro controls
  scene-assets/              parentless Object3D prototypes shared by runtime and editor
public/
  scenes/                    *.iwsdk.scene.json scene composition
  ui/                        *.uikitml spatial panels
```

### XR emulation

IWER is injected by `@iwsdk/vite-plugin-dev`. In this project `iwsdk.config.json`
sets `dev.emulator.injectOnBuild` to `true`, so deployed builds include the
emulator, and `dev.emulator.activation` allows `localhost`, `*.vercel.app` and the
v0 preview hostnames. On a real headset IWER steps aside automatically
(`/OculusBrowser/` is excluded), so Quest uses native WebXR.

WebXR needs a secure context: `https://` deployments and `http://localhost` both
qualify. To test a headset against your dev machine, run
`IWSDK_DEV_HTTPS=1 npm run dev` and accept the self-signed certificate on the
device.

## Deploy on Vercel

`vercel.json` selects the Vite preset, builds to `dist/`, sends
`Permissions-Policy: xr-spatial-tracking=*` so WebXR is allowed, and rewrites
unmatched paths to `/index.html`. Import the repository into
[Vercel](https://vercel.com/new) or run `vercel` from the project root.

## Notes

- Import Three.js classes from `@iwsdk/core`, never from `three`, to avoid a
  duplicate Three.js instance.
- The first `npm install` downloads Chromium for the managed dev tooling. Set
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to skip it when you only need to build.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the
full text. IWSDK itself is MIT-licensed; this project's Apache-2.0 terms cover its
own source, not its dependencies.
