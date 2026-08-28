"use client";

import { usePathname } from "next/navigation";

const specialtyRoots = ["/medtech", "/accounting", "/teachers/", "/law"];

export default function SpecialtyHomeLink() {
  const pathname = usePathname();
  const inSpecialty = specialtyRoots.some((root) => pathname === root || pathname.startsWith(root));
  const inAdmin = pathname.includes("/admin");

  if (!inSpecialty || inAdmin) return null;

  return <a className="specialty-home-link" href="/" aria-label="返回 iBrain Pedia X 首頁">
    <span aria-hidden="true">⌂</span>
    <b>iBrain Pedia X 首頁</b>
  </a>;
}
