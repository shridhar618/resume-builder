"use client";
import { useActionState } from "react";
import { registerAction, type FormState } from "../actions";
import { SubmitButton } from "@/components/client";

export function RegisterForm() {
  const [state, action] = useActionState<FormState, FormData>(registerAction, {});
  const v = state.values ?? {};
  return (
    <form action={action} className="stack" key={JSON.stringify(v)}>
      {state.error && <div className="flash flash-error">{state.error}</div>}
      <div>
        <label htmlFor="name">Full name</label>
        <input id="name" name="name" type="text" defaultValue={v.name} required maxLength={100} autoComplete="name" />
      </div>
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" defaultValue={v.email} required autoComplete="email" />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        <div className="hint">At least 8 characters, with a letter and a number.</div>
      </div>
      <div>
        <label htmlFor="confirm">Confirm password</label>
        <input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <SubmitButton className="btn btn-primary btn-block">Create account</SubmitButton>
    </form>
  );
}
