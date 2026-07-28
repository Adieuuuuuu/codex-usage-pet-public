# Visual references and pet assets

This document tells an Agent what is evidence, what is reusable, and what must
be revalidated before changing the UI.

## Desktop source of truth

The repository's desktop implementation is the visual and behavioral source of
truth for the phone's content hierarchy:

- pet plus compact usage capsule;
- remaining percentage and reset date;
- running and review counts;
- bounded task rows with title, status, and display age;
- light/dark themes, restrained borders, and no decorative dashboard cards.

The desktop UI must be inspected at its supported minimum, default, and maximum
scales. Pet artwork, capsule, task panel, text, and hit regions scale together.
Drag and click behavior must remain distinct.

## Public reference images

This public snapshot contains two deliberately scoped images:

- [desktop-usage-pet-reference.png](images/desktop-usage-pet-reference.png):
  accepted desktop content-hierarchy reference;
- [android-companion-production.png](images/android-companion-production.png):
  API 36 emulator capture of Android 0.3.0 after prototype controls were removed
  and system-bar/display-cutout insets were applied.

The images contain no real task title, endpoint, room ID, pairing material,
device token, prompt, or response. They document one implementation and test
moment. They do not prove long-duration animation, Xiaomi/HyperOS physical
behavior, other Android vendors, macOS, or iOS. Provenance and terms are in the
root [asset license record](../ASSET-LICENSES.md).

## How an Agent should use references

1. Read the nearest evidence `README.md` and verification note.
2. Identify whether the image is a user report, accepted source, before state,
   fixed emulator state, or animation composite.
3. Compare the smallest affected region first; do not redesign adjacent content
   to repair one defect.
4. Preserve hierarchy, copy, colors, radii, row heights, and status semantics
   unless a requirement explicitly changes them.
5. Render through the real host: Electron for desktop and SystemUI for Android
   notifications. A layout preview alone is insufficient.
6. Capture light/dark evidence and the target device's collapsed/expanded state.
7. Record what the image cannot prove.

Android/HyperOS owns the notification's outer header, expansion state, padding,
and maximum custom-content area. The app controls its `RemoteViews` content but
cannot promise a permanently expanded ordinary notification.

## Hatch Pet packages

A standard package contains:

```text
<pet-id>/
  pet.json
  spritesheet.webp
```

The application validates the manifest, path containment, and sprite sheet
dimensions before rendering. Task interpretation is independent of the chosen
pet.

For users without a custom pet:

1. use the licensed bundled `assets/pets/zhima-3` package as the working
   default;
2. allow a valid user-installed Hatch Pet package to override the bundled
   package through the existing discovery order;
3. inspect other installed Codex assets only as local inputs and do not
   redistribute them without permission;
4. keep task interpretation, usage, encryption, and phone synchronization
   independent of pet selection.

The public `zhima-3` package is a validated `spriteVersionNumber: 2` atlas
at `1536x2288` with `192x208` cells. Its distributable scope and attribution
are recorded in [ASSET-LICENSES.md](../ASSET-LICENSES.md). The original private
reference photograph and generation intermediates are not published.

## Visual acceptance checklist

### Desktop

- real task state drives animation;
- usage unavailable state is honest;
- minimum/default/maximum scale remains readable;
- dragging does not open tasks;
- task panel stays on-screen on multi-monitor/DPI changes;
- light/dark modes preserve contrast;
- tray and click-through behavior use the real packaged app.

### Android

- compact capsule is complete in the collapsed slot;
- expanded rows are not clipped;
- values do not overwrite one another;
- running indicator animates without exposing the background;
- ordinary refresh is silent;
- attention alert is short-lived and occurs once;
- hidden/restored task preference persists;
- unrelated notifications do not break layout.

### New platforms

Do not force pixel identity where the operating system owns chrome. Preserve
information hierarchy and interaction meaning, then capture target-platform
evidence and document intentional differences.
