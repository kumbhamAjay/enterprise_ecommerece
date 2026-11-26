import type { Metadata } from "next";
import { Checkout } from "./Checkout";

export const metadata: Metadata = { title: "Checkout" };
export default function Page() {
  return <Checkout />;
}
