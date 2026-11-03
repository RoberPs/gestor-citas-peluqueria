import type { Metadata } from 'next';
import { ChangePasswordForm } from '@/components/owner/change-password-form';
import { OwnerHeader } from '@/components/owner/owner-header';
import { SignOutButton } from '@/components/owner/sign-out-button';
import { MIN_PASSWORD_LENGTH } from '@/domain/owner/account';
import { messages } from '@/messages/es-ES';
import { requireOwnerPage } from '../_lib/require-owner-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: messages.owner.account.title };

/** The owner's account: change the password, sign out (002, FR-004, FR-006). */
export default async function AccountPage() {
  await requireOwnerPage();

  return (
    <>
      <OwnerHeader current="account" />
      <main>
        <h1>{messages.owner.account.title}</h1>

        <section aria-labelledby="password-heading" className="card">
          <h2 id="password-heading">{messages.owner.account.changePassword}</h2>
          <ChangePasswordForm minLength={MIN_PASSWORD_LENGTH} />
        </section>

        <section aria-labelledby="sign-out-heading">
          <h2 id="sign-out-heading">{messages.owner.nav.signOut}</h2>
          <p className="muted">{messages.owner.account.signOutHint}</p>
          <SignOutButton />
        </section>
      </main>
    </>
  );
}
