import { tv } from 'tailwind-variants'

import { panelIconButtonBase } from './panel/field'

const theme = {
  base: 'flex cursor-pointer items-center justify-center bg-transparent text-muted outline-none hover:bg-hover hover:text-surface focus-visible:border-panel-focus',
  variants: {
    size: {
      sm: 'size-5 rounded border-none text-sm leading-none',
      // Standalone actions (e.g. a reply's delete button) can be roomier than a
      // panel header action. shrink-0 keeps the SVG from being squeezed by flex.
      lg: 'size-7 shrink-0 rounded border-none text-base leading-none',
      md: panelIconButtonBase
    },
    active: {
      true: 'border-accent text-accent'
    },
    disabled: {
      true: 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted'
    }
  },
  defaultVariants: {
    size: 'sm' as const,
    active: false as const,
    disabled: false as const
  }
}

const iconButton = tv(theme)

/** The icon button's classes for when a component must render its own button element
 *  (reka-ui's `as-child` triggers need a real element to anchor their popper to). */
export function iconButtonClass(
  options?: {
    size?: 'sm' | 'md' | 'lg'
    active?: boolean
    disabled?: boolean
    class?: string
  }
) {
  return iconButton(options)
}

export default theme
