import { Suspense } from "react";
import type { Metadata } from "next";
import { Account } from "./Account";

export const metadata: Metadata = { title: "My account" };
export default function Page() {
  return <Suspense><Account /></Suspense>;
}
