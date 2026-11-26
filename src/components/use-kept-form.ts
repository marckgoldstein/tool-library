"use client";

import { useActionState, useTransition, type FormEvent } from "react";

/**
 * Runs a server action from a form without React's automatic form reset, so
 * when the server sends back an error, everything the person entered stays,
 * including chosen photos (file inputs can't be refilled from state).
 *
 * Use as: <form action={formAction} onSubmit={onSubmit}>. Without JavaScript
 * the form still posts through `action`. Native validation runs first: the
 * submit event only fires for a valid form.
 */
export function useKeptFormAction<S>(action: (state: Awaited<S>, formData: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, formAction, pending] = useActionState(action, initial);
  const [, startTransition] = useTransition();
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(formData));
  };
  return { state, formAction, onSubmit, pending };
}
