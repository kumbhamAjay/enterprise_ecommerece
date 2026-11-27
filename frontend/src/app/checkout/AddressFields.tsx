"use client";
import { Input } from "@/components/ui/Field";
import type { OrderAddress } from "@/lib/types";

export const emptyAddress: OrderAddress = { fullName: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "", phone: "" };

export function AddressFields({ value, onChange, errors = {} }: { value: OrderAddress; onChange: (v: OrderAddress) => void; errors?: Record<string, string> }) {
  const set = (k: keyof OrderAddress) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-5">
      <Input label="Full name" autoComplete="name" value={value.fullName} onChange={set("fullName")} error={errors.fullName} />
      <Input label="Street address" autoComplete="address-line1" value={value.line1} onChange={set("line1")} error={errors.line1} />
      <Input label="Apartment, suite (optional)" autoComplete="address-line2" value={value.line2 ?? ""} onChange={set("line2")} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="City" autoComplete="address-level2" value={value.city} onChange={set("city")} error={errors.city} />
        <Input label="State / region" autoComplete="address-level1" value={value.state ?? ""} onChange={set("state")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Postal code" autoComplete="postal-code" value={value.postalCode ?? ""} onChange={set("postalCode")} />
        <Input label="Country" autoComplete="country-name" value={value.country} onChange={set("country")} error={errors.country} />
      </div>
      <Input label="Phone (optional)" type="tel" autoComplete="tel" value={value.phone ?? ""} onChange={set("phone")} hint="For the courier only." />
    </div>
  );
}

// Drop empty optional fields so the request body (and its idempotency signature) is stable
export const clean = (a: OrderAddress): OrderAddress =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v !== "")) as unknown as OrderAddress;
