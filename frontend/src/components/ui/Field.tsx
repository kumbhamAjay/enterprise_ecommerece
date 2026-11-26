"use client";
import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

const control =
  "w-full rounded-[3px] border bg-paper px-4 text-sm text-ink placeholder:text-mute/70 transition-colors duration-200 hover:border-ink/40 focus:border-ink focus:outline-none disabled:bg-sand disabled:text-mute";

type Base = { label: string; error?: string; hint?: string; right?: ReactNode };

function Wrap({ id, label, error, hint, right, children }: Base & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="eyebrow !text-ink-soft">
          {label}
        </label>
        {right}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-mute">{hint}</p>
      )}
    </div>
  );
}

export function Input({ label, error, hint, right, className = "", ...p }: Base & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Wrap {...{ id, label, error, hint, right }}>
      <input id={id} aria-invalid={!!error} {...p} className={`${control} h-12 ${error ? "border-danger" : "border-line"} ${className}`} />
    </Wrap>
  );
}

export function PasswordInput({ label, error, hint, right, ...p }: Base & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <Wrap {...{ id, label, error, hint, right }}>
      <div className="relative">
        <input id={id} aria-invalid={!!error} {...p} type={show ? "text" : "password"} className={`${control} h-12 pr-12 ${error ? "border-danger" : "border-line"}`} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-mute hover:text-ink">
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </Wrap>
  );
}

export function Textarea({ label, error, hint, right, ...p }: Base & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Wrap {...{ id, label, error, hint, right }}>
      <textarea id={id} {...p} className={`${control} min-h-28 resize-y py-3 ${error ? "border-danger" : "border-line"}`} />
    </Wrap>
  );
}

export function Select({ label, error, hint, right, children, ...p }: Base & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Wrap {...{ id, label, error, hint, right }}>
      <select id={id} {...p} className={`${control} h-12 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='none' stroke='%238b837a' stroke-width='1.6'%3E%3Cpath d='m1 1 5 5 5-5'/%3E%3C/svg%3E")] bg-[length:12px] bg-[right_1rem_center] bg-no-repeat pr-10 ${error ? "border-danger" : "border-line"}`}>
        {children}
      </select>
    </Wrap>
  );
}
