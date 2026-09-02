"use client";

import { createContext, useContext } from "react";

const MedtechAdminAccessContext = createContext({ fullAdmin: false, questionEditor: false, documentLibraryEditor: false });

export function MedtechAdminAccessProvider({ fullAdmin, questionEditor, documentLibraryEditor, children }: { fullAdmin: boolean; questionEditor: boolean; documentLibraryEditor: boolean; children: React.ReactNode }) {
  return <MedtechAdminAccessContext.Provider value={{ fullAdmin, questionEditor, documentLibraryEditor }}>{children}</MedtechAdminAccessContext.Provider>;
}

export function useMedtechAdminAccess() {
  return useContext(MedtechAdminAccessContext);
}
