"use client";
import { useState } from "react";
import { ProductImage } from "./ProductCard";

export function Gallery({ images, name }: { images: { id: string; url: string }[]; name: string }) {
  const [i, setI] = useState(0);
  const list = images.length ? images : [{ id: "none", url: "" }];
  return (
    <div className="grid gap-4 lg:grid-cols-[88px_1fr]">
      <div className="order-2 flex gap-3 overflow-x-auto lg:order-1 lg:flex-col">
        {list.length > 1 &&
          list.map((img, n) => (
            <button
              key={img.id}
              onClick={() => setI(n)}
              aria-label={`Show image ${n + 1}`}
              aria-current={n === i}
              className={`aspect-square w-20 shrink-0 overflow-hidden rounded-[3px] bg-sand transition-all duration-300 lg:w-full ${n === i ? "ring-1 ring-ink ring-offset-2 ring-offset-ivory" : "opacity-60 hover:opacity-100"}`}
            >
              <ProductImage w={160} src={img.url || null} alt={`${name} ${n + 1}`} className="h-full w-full object-contain p-2" />
            </button>
          ))}
      </div>
      <div className="order-1 aspect-[4/5] overflow-hidden rounded-[3px] bg-sand lg:order-2">
        <ProductImage w={1100} key={list[i].id} src={list[i].url || null} alt={name} className="h-full w-full object-contain p-10 [animation:fade-in_0.5s_both] sm:p-16" />
      </div>
    </div>
  );
}
