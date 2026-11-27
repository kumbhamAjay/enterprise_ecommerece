import { Suspense } from "react";
import type { Metadata } from "next";
import { Verify } from "./Verify";

export const metadata: Metadata = { title: "Verify email" };
export default function Page() {
  return <Suspense><Verify /></Suspense>;
}
