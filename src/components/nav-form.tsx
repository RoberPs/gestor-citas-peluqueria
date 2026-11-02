'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition, type ComponentProps, type FormEvent } from 'react';

/**
 * A GET form that navigates inside the app instead of reloading the page
 * (003, D-003), so the booking draft and the live regions stay mounted.
 *
 * `next/form` would do the same, but it builds the URL from the form fields
 * alone and drops the pressed button's `name`/`value` — which is exactly how
 * the day, the hour, the service and the range are chosen here. Without
 * JavaScript this is a plain GET form, as in 001.
 *
 * While a choice is on its way, the screen being left is still in view. Any
 * other choice made on it would act on what is no longer there — an hour of
 * the previous day — so it is ignored, and `html[data-navigating]` lets the
 * stylesheet show that the screen is loading (Principio VI).
 */

/** Where the navigation under way started from; shared by every form on the page. */
let pendingFrom: string | null = null;

export function NavForm({
  action,
  ...props
}: Omit<ComponentProps<'form'>, 'action' | 'method' | 'onSubmit'> & { readonly action: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isPending) return undefined;

    const root = document.documentElement;
    root.dataset['navigating'] = '';
    return () => {
      delete root.dataset['navigating'];
      pendingFrom = null;
    };
  }, [isPending]);

  function navigate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Once the URL has moved on, the new screen is the one in view.
    if (pendingFrom === window.location.href) return;

    const { submitter } = event.nativeEvent as SubmitEvent;
    const target = new URL(action, window.location.href);
    target.search = '';

    for (const [name, value] of new FormData(event.currentTarget, submitter)) {
      if (typeof value === 'string') target.searchParams.append(name, value);
    }

    pendingFrom = window.location.href;
    startTransition(() => {
      router.push(`${target.pathname}${target.search}`);
    });
  }

  return <form {...props} method="get" action={action} onSubmit={navigate} />;
}
