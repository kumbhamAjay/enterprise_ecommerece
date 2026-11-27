import type { Metadata } from "next";
import { OrdersList } from "./OrdersList";

export const metadata: Metadata = { title: "My orders" };
export default function Page() {
  return <OrdersList />;
}
