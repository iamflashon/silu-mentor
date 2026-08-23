export function memberLoginPath(returnTo = "/") {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\") ? returnTo : "/";
  const loginPath = safe === "/medtech" || safe.startsWith("/medtech/")
    ? "/medtech/member-login"
    : "/member-login";
  return `${loginPath}?return_to=${encodeURIComponent(safe)}`;
}
