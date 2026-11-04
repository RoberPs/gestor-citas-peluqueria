import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/owner/sign-in-form';
import { messages } from '@/messages/es-ES';
import { hasOwnerSession } from '../_lib/require-owner-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: messages.owner.signIn.title };

/**
 * The owner's sign-in (002, Historia 1). One column at every width (D-034). It
 * shows nothing about the salon but its own form: the page is public.
 */
export default async function SignInPage() {
  if (await hasOwnerSession()) redirect('/gestion/agenda');

  return (
    <>
      <header className="site-header">
        <p>{messages.owner.title}</p>
      </header>
      <main>
        <h1>{messages.owner.signIn.title}</h1>
        <SignInForm next="/gestion/agenda" />
        <p className="muted">{messages.owner.signIn.forgotten}</p>
      </main>
    </>
  );
}
