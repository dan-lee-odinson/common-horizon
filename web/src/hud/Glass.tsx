// A translucent glass panel: the basic surface of the HUD. Corner brackets mark its extent.

import type { ComponentPropsWithRef, ElementType } from 'react';

type Tone = 'cyan' | 'sun' | 'earth' | 'bad';

type GlassProps<T extends ElementType> = {
  as?: T;
  /** Corner brackets, tinted to match what the panel is about. */
  brackets?: boolean;
  tone?: Tone;
  /** Denser glass for long text (the assistant, the planner). */
  strong?: boolean;
} & Omit<ComponentPropsWithRef<T>, 'as'>;

const BRACKETS: Record<Tone, string> = { cyan: 'brackets', sun: 'brackets brackets-sun', earth: 'brackets brackets-earth', bad: 'brackets brackets-bad' };

export function Glass<T extends ElementType = 'div'>({ as, brackets = true, tone = 'cyan', strong = false, className = '', ...rest }: GlassProps<T>) {
  const Tag: ElementType = as ?? 'div';
  return <Tag className={`glass ${strong ? 'glass-strong ' : ''}${brackets ? `${BRACKETS[tone]} ` : ''}${className}`} {...rest} />;
}
