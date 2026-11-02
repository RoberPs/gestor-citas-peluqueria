'use client';

import { useRouter } from 'next/navigation';
import type { ComponentProps, FormEvent } from 'react';

/**
 * A GET form that navigates inside the app instead of reloading the page
 * (003, D-003), so the booking draft and the live regions stay mounted.
 *
 * `next/form` would do the same, but it builds the URL from the form fields
 * alone and drops the pressed button's `name`/`value` — which is exactly how
 * the day, the hour, the service and the range are chosen here. Without
 * JavaScript this is a plain GET form, as in 001.
 */
export function NavForm({
  action,
  ...props
}: Omit<ComponentProps<'form'>, 'action' | 'method' | 'onSubmit'> & { readonly action: string }) {
  const router = useRouter();

  function navigate(event: FormEvent<HTMLFormElement>) {
    const { submitter } = event.nativeEvent as SubmitEvent;
    const target = new URL(action, window.location.href);
    target.search = '';

    for (const [name, value] of new FormData(event.currentTarget, submitter)) {
      if (typeof value === 'string') target.searchParams.append(name, value);
    }

    event.preventDefault();
    router.push(`${target.pathname}${target.search}`);
  }

  return <form {...props} method="get" action={action} onSubmit={navigate} />;
}
