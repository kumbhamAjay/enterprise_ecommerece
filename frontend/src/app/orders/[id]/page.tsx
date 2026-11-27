import { Suspense } from "react";
import type { Metadata } from "next";
import { OrderDetail } from "./OrderDetail";

export const metadata: Metadata = { title: "Order" };
export default function Page() {
  return <Suspense><OrderDetail /></Suspense>;
}
