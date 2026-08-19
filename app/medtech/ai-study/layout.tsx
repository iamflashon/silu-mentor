import MedtechTabs from "../MedtechTabs";
export default function GuidedStudyLayout({children}:{children:React.ReactNode}){return <div className="medtech-guided-layout"><MedtechTabs active="guided" />{children}</div>}
