import { Suspense } from "react";
import type { Metadata } from "next";
import { Listing, ListingSkeleton } from "./Listing";

export const metadata: Metadata = { title: "Shop" };

// useSearchParams() in <Listing> needs a Suspense boundary
export default function ProductsPage() {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <Listing />
    </Suspense>
  );
}
