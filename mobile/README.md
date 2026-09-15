# Tasky mobile

Expo / React Native iOS client for Tasky. Run it from `tasky/mobile`.

```bash
npm install
cd ios && pod install && cd ..
npm run ios:dev -- --device
```

`pod install` is required after a fresh checkout (or after moving this folder). CocoaPods bakes in absolute paths. Bluetooth scale support needs a physical iPhone; Expo Go and the simulator cannot connect.

## Temporary: iOS 27 UIScene lifecycle

Apps built with the iOS 27 SDK crash on launch unless they adopt UIKit scenes
([TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle)).
Expo SDK 57 still emits the old AppDelegate-owned `UIWindow` template
([expo/expo#46664](https://github.com/expo/expo/issues/46664)).

Until Expo ships that (they closed a full SDK 57 backport in favor of an
opt-in plugin), this app has a local workaround:

- `ios/Tasky/AppDelegate.swift` — `SceneDelegate` starts React Native; keep
  factory setup in `AppDelegate`
- `ios/Tasky/Info.plist` and `app.json` `ios.infoPlist` — `UIApplicationSceneManifest`

Remove those once Expo's scene lifecycle lands in this SDK, then rebuild. Do
not `expo prebuild --clean` without re-applying them, or the launch crash
returns.

Debug device builds also set `ios.buildReactNativeFromSource` in
`ios/Podfile.properties.json` so Expo Dev Launcher can link against
`RCTPackagerConnection`.

## YUNMAI Mini scale

Settings → YUNMAI scale. Tap Connect, wake the scale, and step on. The first
time, select the scale; later Connect reconnects to the last one. An unfinished
weigh-in times out after 30 seconds of inactivity. Save writes pounds to the
uniquely named Weight activity signal (weight measurement only).

`modules/tasky-scale` is a local Expo module using CoreBluetooth (`FFE0/FFE4`
notifications, protocol version via `FFE5/FFE9`). Bluetooth permission lives in
`app.config.js` and the checked-in iOS Info.plist.

Only a completed packet preceded by a live reading in the current session can
be saved. Phone receipt time is used because the scale clock may be wrong.
Retries use the same backend idempotency key. Leaving or backgrounding the
screen stops Bluetooth. Body-composition estimates are not written.

Protocol references:
- https://github.com/oliexdev/openScale/issues/71
- https://gist.github.com/conoro/f0c1d96c450a8f5cce70e2846c3686c4

```bash
npx jest lib/__tests__/yunmaiProtocol.test.ts --runInBand --watch=false
```
