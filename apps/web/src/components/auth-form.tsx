import type { ReactNode } from "react";

/** Centered card for login, MFA and password pages. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <p className="text-sm font-semibold tracking-wide text-neutral-600">CommuCal</p>
      <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      <div className="mt-6">{children}</div>
    </main>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type?: "email" | "password" | "text";
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  inputMode?: "numeric" | "text";
  required?: boolean;
  autoFocus?: boolean;
}

export function Field({
  id,
  label,
  type = "text",
  autoComplete,
  value,
  onChange,
  hint,
  inputMode,
  required = true,
  autoFocus = false,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required={required}
        // biome-ignore lint/a11y/noAutofocus: the single field of a one-step form; focus is where the user types next
        autoFocus={autoFocus}
        aria-describedby={hintId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full rounded-md border border-neutral-400 px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
      />
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-neutral-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-blue-800 px-4 py-2 font-medium text-white hover:bg-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-60"
    >
      {pending ? "Bitte warten …" : children}
    </button>
  );
}

/** Error or status message, announced by screen readers. */
export function FormMessage({ kind, children }: { kind: "error" | "info"; children: ReactNode }) {
  if (!children) {
    return null;
  }
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={
        kind === "error"
          ? "mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
          : "mb-4 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900"
      }
    >
      {children}
    </p>
  );
}
