"use client";

import { useEffect, useState } from "react";

export type MedtechPublicProduct = {
  title: string;
  effectivePrice: number;
  accessDays: number;
  trialQuestions: number;
  saleActive: boolean;
  saleLabel: string;
  entitlement: {
    purchased: true;
    startedAt: string;
    availableUntil: string;
  } | null;
};

export function useMedtechProductSettings() {
  const [product, setProduct] = useState<MedtechPublicProduct | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/medtech/product", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as {
          product?: MedtechPublicProduct;
        };
        if (active && response.ok && data.product) setProduct(data.product);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return product;
}
