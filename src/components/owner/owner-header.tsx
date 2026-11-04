import { messages } from '@/messages/es-ES';
import { SignOutButton } from './sign-out-button';

export type OwnerSection = 'agenda' | 'bookings' | 'account';

const LINKS: readonly { readonly section: OwnerSection; readonly href: string }[] = [
  { section: 'agenda', href: '/gestion/agenda' },
  { section: 'bookings', href: '/gestion/reservas' },
  { section: 'account', href: '/gestion/cuenta' },
];

/**
 * The header of every owner screen (002): the salon's side, its sections and
 * the way out. The current section is said with `aria-current`, not only with
 * a style (Principio VII).
 */
export function OwnerHeader({
  current,
  split = false,
}: {
  readonly current: OwnerSection;
  /** For the two-column screens, whose header widens with them (003, D-034). */
  readonly split?: boolean;
}) {
  return (
    <header className={split ? 'site-header site-header--split' : 'site-header'}>
      <p>{messages.owner.title}</p>
      <nav aria-label={messages.owner.nav.label} className="owner-nav">
        <ul>
          {LINKS.map((link) => (
            <li key={link.section}>
              <a href={link.href} aria-current={link.section === current ? 'page' : undefined}>
                {messages.owner.nav[link.section]}
              </a>
            </li>
          ))}
        </ul>
        <SignOutButton className="owner-nav-signout" />
      </nav>
    </header>
  );
}
