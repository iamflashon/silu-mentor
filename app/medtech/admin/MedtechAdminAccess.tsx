"use client";

import { createContext, useContext } from "react";

const MedtechAdminAccessContext = createContext({ fullAdmin: false, questionEditor: false });

export function MedtechAdminAccessProvider({ fullAdmin, questionEditor, children }: { fullAdmin: boolean; questionEditor: boolean; children: React.ReactNode }) {
  return <MedtechAdminAccessContext.Provider value={{ fullAdmin, questionEditor }}>{children}</MedtechAdminAccessContext.Provider>;
}

export function useMedtechAdminAccess() {
  return useContext(MedtechAdminAccessContext);
}
