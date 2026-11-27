import { Suspense } from "react";
import type { Metadata } from "next";
import { Admin } from "./Admin";

export const metadata: Metadata = { title: "Catalog admin" };
export default function Page() {
  return <Suspense><Admin /></Suspense>;
}
