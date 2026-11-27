import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: "Reset password" };
export default function Page() {
  return <Suspense><ResetForm /></Suspense>;
}
