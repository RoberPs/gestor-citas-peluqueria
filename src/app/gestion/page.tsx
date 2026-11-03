import { redirect } from 'next/navigation';
import { requireOwnerPage } from './_lib/require-owner-page';

export const dynamic = 'force-dynamic';

/** `/gestion` is the agenda of today; without a session, the sign-in form. */
export default async function OwnerHome() {
  await requireOwnerPage();
  redirect('/gestion/agenda');
}
