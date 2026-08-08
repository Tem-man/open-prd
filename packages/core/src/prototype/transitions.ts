import type { PrototypeEasing, PrototypeTransitionType } from '@open-pencil/scene-graph'

/** Frame transitions that translate rather than cross-fade. */
const SLIDE_AXIS: Partial<Record<PrototypeTransitionType, 'X' | 'Y'>> = {
  'slide-left': 'X',
  'slide-right': 'X',
  'slide-up': 'Y',
  'slide-down': 'Y',
  'push-left': 'X',
  'push-right': 'X',
  'push-up': 'Y',
  'push-down': 'Y'
}

/**
 * Direction the incoming frame travels in. `slide-left` means the target enters from the
 * right edge, so it starts at a positive offset and moves toward 0.
 */
const ENTER_SIGN: Partial<Record<PrototypeTransitionType, 1 | -1>> = {
  'slide-left': 1,
  'slide-right': -1,
  'slide-up': 1,
  'slide-down': -1,
  'push-left': 1,
  'push-right': -1,
  'push-up': 1,
  'push-down': -1
}

export function applyEasing(t: number, easing: PrototypeEasing): number {
  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t * t
    case 'ease-out':
      return 1 - Math.pow(1 - t, 3)
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'spring':
      return 1 - Math.exp(-6 * t) * Math.cos(12 * t)
    default:
      return t
  }
}

export function isSmartAnimate(type: PrototypeTransitionType): boolean {
  return type === 'smart'
}

/**
 * CSS style for one of the two frames taking part in a transition.
 *
 * `progress` is already eased. `slide-*` leaves the outgoing frame in place while the
 * incoming one covers it; `push-*` moves both.
 */
export function getFrameTransitionStyle(
  phase: 'from' | 'to',
  type: PrototypeTransitionType,
  progress: number,
  frameWidth: number,
  frameHeight: number
): Record<string, string> {
  if (type === 'dissolve' || type === 'fade') {
    return { opacity: String(phase === 'to' ? progress : 1 - progress) }
  }

  const axis = SLIDE_AXIS[type]
  const sign = ENTER_SIGN[type]
  if (!axis || !sign) return {}

  const distance = axis === 'X' ? frameWidth : frameHeight

  if (phase === 'to') {
    return { transform: `translate${axis}(${distance * sign * (1 - progress)}px)` }
  }
  // `slide-*` keeps the outgoing frame still; `push-*` shifts it out the opposite way.
  if (!type.startsWith('push')) return {}
  return { transform: `translate${axis}(${distance * -sign * progress}px)` }
}

/** Anchor styles for an overlay frame inside the presented viewport. */
export function getOverlayAnchorStyle(
  position: 'center' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
): Record<string, string> {
  switch (position) {
    case 'top':
      return { top: '0', left: '50%', transform: 'translateX(-50%)' }
    case 'bottom':
      return { bottom: '0', left: '50%', transform: 'translateX(-50%)' }
    case 'top-left':
      return { top: '0', left: '0' }
    case 'top-right':
      return { top: '0', right: '0' }
    case 'bottom-left':
      return { bottom: '0', left: '0' }
    case 'bottom-right':
      return { bottom: '0', right: '0' }
    default:
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }
}
