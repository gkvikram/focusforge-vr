// The IWER emulator replaces navigator.userAgent with a Quest 3 string on the page itself, so the
// real value is read from the prototype getter, which the emulator leaves untouched.
function readRealUserAgent(): string {
  const getter = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')?.get;
  return getter != null ? getter.call(navigator) : navigator.userAgent;
}

const realUserAgent = readRealUserAgent();

const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const mobileUserAgent = /Android|iPhone|iPad|Mobile/i.test(realUserAgent);

// Quest Browser's user agent contains "Mobile", so headset browsers are excluded explicitly.
const headsetUserAgent = /OculusBrowser|Quest|Pico|Wolvic|VIVE|SamsungBrowser.*VR/i.test(realUserAgent);

export const isMobile: boolean = hasTouch && mobileUserAgent;

/** True on phones and tablets without a headset, where the IWER controller overlay must never open. */
export const isPhoneWithoutHeadset: boolean = isMobile && !headsetUserAgent;
